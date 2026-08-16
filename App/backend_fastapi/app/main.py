from __future__ import annotations

from dotenv import load_dotenv

load_dotenv()

import asyncio
import hashlib
import json
import logging
import os
import re
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from io import BytesIO
from datetime import date
from typing import List, Optional

import httpx
import ollama
from fastapi import Depends, FastAPI, File, Form, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from core.cache import get_redis_client
from core.security import verify_internal_api_key
from llm_rag_assistant.app.routers.chat_router import router as rag_router
from llm_rag_assistant.app.routers.assistant_router import router as assistant_router
from llm_rag_assistant.app.graph.assistant_graph import close_graph
from llm_rag_assistant.app.services.embedding_service import preload_embedding_model
from llm_rag_assistant.app.services.rag_queue_service import RagQueueWorker
from ml_workload_score.app.routers.workload_router import router as workload_router
from ai_contribution_report.app.routers.contribution_router import router as contribution_report_router
from ml_delay_risk.routers.delay_router import router as delay_risk_router
from contribution_score.app.routers.contribution_router import router as contribution_score_router
from llm_checklist.app.routers.checklist_router import router as checklist_router

# 앱 로거의 INFO 가 실제로 나가게 한다.
#
# 기동 명령은 `uvicorn app.main:app` 하나뿐이고(docker-entrypoint.sh), uvicorn 은 자기
# dictConfig 로 uvicorn* 로거만 잡을 뿐 루트에는 핸들러를 달지 않는다. 그래서 앱 로거의
# INFO 는 핸들러 없는 루트로 전파되고 logging.lastResort 가 WARNING 이상만 내보낸다.
# 결과적으로 INFO 관측은 무엇을 넣어도 사라진다 - 라우팅 때 넣은 "코드 라우팅 발동" 로그가
# 운영에서 한 번도 찍히지 않은 이유다(2026-08-01 확인, 운영 로그 grep 0건).
#
# basicConfig 는 루트에 핸들러가 이미 있으면 아무것도 하지 않는다. 덕분에 pytest 처럼
# 자기 핸들러를 붙이는 환경은 건드리지 않고, 운영처럼 비어 있을 때만 채운다.
# 바꿔 말하면 이 설정이 깨졌는지는 같은 프로세스 안에서 검증할 수 없다
# (tests/test_logging_config.py 가 별도 프로세스를 쓰는 이유).
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

logger = logging.getLogger(__name__)

DEFAULT_OLLAMA_HOST = "http://localhost:11434"
DEFAULT_MEETING_ANALYSIS_MODEL = "qwen2.5:1.5b"
DEFAULT_MEETING_ANALYSIS_TIMEOUT_SECONDS = 20.0
DEFAULT_MEETING_ANALYSIS_MAX_CHARS = 6000
DEFAULT_MEETING_ANALYSIS_NUM_PREDICT = 650
DEFAULT_MEETING_ANALYSIS_KEEP_ALIVE = "5m"
DEFAULT_OLLAMA_ANALYSIS_TEMPERATURE = 0.1
DEFAULT_HF_MEETING_ANALYSIS_MODEL = "Qwen/Qwen3-4B-Instruct-2507"
DEFAULT_HF_MEETING_ANALYSIS_TIMEOUT_SECONDS = 35.0
DEFAULT_HF_MEETING_ANALYSIS_MAX_TOKENS = 900
DEFAULT_HF_MEETING_ANALYSIS_TEMPERATURE = 0.1
HF_CHAT_COMPLETIONS_URL = "https://router.huggingface.co/v1/chat/completions"
# v2: 요청에 sections(양식 기반 섹션 본문)가 추가됐다. 올리지 않으면 같은 텍스트의 기존 캐시가
# 섹션을 무시한 분석 결과를 그대로 돌려준다.
MEETING_ANALYSIS_CACHE_SCHEMA_VERSION = 2
MEETING_ANALYSIS_CACHE_TTL_SECONDS = 86400
DEFAULT_WHISPER_MODEL_SIZE = "small"
DEFAULT_WHISPER_DEVICE = "cpu"
DEFAULT_WHISPER_COMPUTE_TYPE = "int8"
DEFAULT_WHISPER_LANGUAGE = "ko"
AUDIO_FILE_EXTENSIONS = (".mp3", ".wav", ".m4a", ".ogg")

rag_queue_worker = RagQueueWorker()


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    # 첫 RAG 요청이 임베딩 모델 다운로드/로딩 지연(콜드 스타트)을 떠안지 않도록 기동 시 미리 로드한다.
    try:
        await preload_embedding_model()
    except Exception:
        logger.exception("RAG 임베딩 모델 사전 로드 실패 - 첫 요청 시 재시도됩니다.")
    # 첫 음성 회의록 분석 요청이 Whisper 모델 로딩 지연(콜드 스타트, 측정 결과 약 50초)을
    # 떠안지 않도록 기동 시 미리 로드한다.
    try:
        await asyncio.to_thread(get_whisper_model)
    except Exception:
        logger.exception("Whisper STT 모델 사전 로드 실패 - 첫 요청 시 재시도됩니다.")
    # RAG 채팅(/ai/rag/query)이 rag-jobs 스트림에 적재하는 작업을 처리할 백그라운드 워커.
    # start()는 루프만 띄우고 Redis에 접속하지 않는다 - 컨슈머 그룹 생성과 폴링은 루프 안에서
    # 백오프를 두고 재시도하므로, 기동 시점에 Redis가 죽어 있어도 복구되면 워커가 알아서 붙는다.
    # 그래도 lifespan 전체가 실패해 RAG와 무관한 다른 라우터(지연 위험도, 업무 편중, 회의록 등)까지
    # 못 뜨는 일이 없도록, 위의 임베딩/Whisper 사전로드와 같은 방식으로 예외는 삼키고 진행한다.
    try:
        await rag_queue_worker.start()
    except Exception:
        logger.exception("RAG 큐 워커 기동 실패 - RAG 채팅은 복구 전까지 응답하지 못합니다.")
    yield
    await rag_queue_worker.stop()
    # 명령 그래프 체크포인터가 잡은 Redis 연결을 닫는다.
    await close_graph()


app = FastAPI(title="WorkFlow AI FastAPI", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(rag_router)
app.include_router(assistant_router)
app.include_router(workload_router)
app.include_router(contribution_report_router)
app.include_router(delay_risk_router)
app.include_router(contribution_score_router)
app.include_router(checklist_router)


@app.get("/")
def root():
    return {
        "service": "WorkFlow AI FastAPI",
        "status": "UP",
        "health": "/api/v1/health",
        "docs": "/docs",
        "web": "http://localhost:5173",
    }


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return Response(status_code=204)


class MeetingSections(BaseModel):
    """서비스가 제공한 회의록 양식으로 작성된 문서에서 Spring이 잘라낸 섹션 본문."""

    discussion: str = ""
    decisions: str = ""
    todos: str = ""
    issues: str = ""


class AnalyzeRequest(BaseModel):
    project_id: str = "demo-project"
    title: str = "회의록 AI 분석 회의"
    meeting_date: str = Field(default_factory=lambda: date.today().isoformat())
    meeting_kind: str = "정기회의"
    source_type: str = "document"
    file_name: Optional[str] = None
    text: str = ""
    participants: List[str] = Field(default_factory=list)
    # 양식으로 작성되지 않은 문서와 음성 업로드는 None이고, 이때 분석은 기존 전체 텍스트 경로를 탄다.
    sections: Optional[MeetingSections] = None


class MeetingTodo(BaseModel):
    title: str
    description: str
    assignee_candidate: str
    assignee_id: Optional[str] = None
    # 시작일. 회의록에 명시된 경우에만 채우고, 없으면 팀장이 역할분배 화면에서 입력한다.
    start_date: Optional[str] = None
    due_date: Optional[str] = None
    priority: str
    category: str
    needs_leader_review: bool = True
    evidence_text: str = ""


class MeetingMeta(BaseModel):
    title: str
    meeting_date: str
    participants: List[str]


class MeetingAnalysisResult(BaseModel):
    summary: str
    decisions: List[str]
    todos: List[MeetingTodo]
    risks: List[str]
    keywords: List[str]
    meeting_meta: MeetingMeta


class AudioTranscribeResult(BaseModel):
    text: str


@app.get("/api/v1/health")
def health():
    return {"service": "workflow-ai-fastapi", "status": "UP"}


@app.post("/api/v1/meetings/analyze-json", response_model=MeetingAnalysisResult)
def analyze_json(request: AnalyzeRequest, _: None = Depends(verify_internal_api_key)):
    canonical_request = _canonicalize_analysis_request(request)
    cache_key = _meeting_analysis_cache_key(canonical_request)
    cache_client = None
    try:
        cache_client = get_redis_client()
    except Exception:
        logger.warning("회의록 분석 Redis 캐시 클라이언트 생성 실패")

    if cache_client is not None:
        try:
            cached_result = cache_client.get(cache_key)
        except Exception:
            logger.warning("회의록 분석 Redis 캐시 조회 실패")
        else:
            if cached_result is not None:
                try:
                    return MeetingAnalysisResult.model_validate_json(cached_result)
                except Exception:
                    logger.warning("회의록 분석 Redis 캐시 데이터 검증 실패")
                    try:
                        cache_client.delete(cache_key)
                    except Exception:
                        logger.warning("회의록 분석 Redis 손상 캐시 삭제 실패")

    result = _analyze_json_uncached(canonical_request)
    if cache_client is not None:
        try:
            cache_client.set(
                cache_key,
                result.model_dump_json(),
                ex=MEETING_ANALYSIS_CACHE_TTL_SECONDS,
            )
        except Exception:
            logger.warning("회의록 분석 Redis 캐시 저장 실패")
    return result


def _canonicalize_analysis_request(request: AnalyzeRequest) -> AnalyzeRequest:
    return request.model_copy(update={"participants": sorted(request.participants)})


def _meeting_analysis_cache_key(request: AnalyzeRequest) -> str:
    cache_input = {
        "schema_version": MEETING_ANALYSIS_CACHE_SCHEMA_VERSION,
        "request": request.model_dump(mode="json"),
        "provider": os.getenv("MEETING_ANALYSIS_PROVIDER", "auto").lower(),
        "huggingface_configured": _huggingface_configured(),
        "ollama": {
            "host": os.getenv("OLLAMA_HOST", DEFAULT_OLLAMA_HOST),
            "model": os.getenv("MEETING_ANALYSIS_MODEL", DEFAULT_MEETING_ANALYSIS_MODEL),
            "timeout_seconds": os.getenv(
                "MEETING_ANALYSIS_TIMEOUT_SECONDS",
                str(DEFAULT_MEETING_ANALYSIS_TIMEOUT_SECONDS),
            ),
            "max_chars": os.getenv("MEETING_ANALYSIS_MAX_CHARS", str(DEFAULT_MEETING_ANALYSIS_MAX_CHARS)),
            "num_predict": os.getenv(
                "MEETING_ANALYSIS_NUM_PREDICT",
                str(DEFAULT_MEETING_ANALYSIS_NUM_PREDICT),
            ),
            "keep_alive": os.getenv(
                "MEETING_ANALYSIS_KEEP_ALIVE",
                DEFAULT_MEETING_ANALYSIS_KEEP_ALIVE,
            ),
            "temperature": os.getenv(
                "OLLAMA_ANALYSIS_TEMPERATURE",
                str(DEFAULT_OLLAMA_ANALYSIS_TEMPERATURE),
            ),
        },
        "huggingface": {
            "endpoint": os.getenv("HF_MEETING_ANALYSIS_ENDPOINT", HF_CHAT_COMPLETIONS_URL),
            "model": os.getenv("HF_MEETING_ANALYSIS_MODEL", DEFAULT_HF_MEETING_ANALYSIS_MODEL),
            "timeout_seconds": os.getenv(
                "HF_MEETING_ANALYSIS_TIMEOUT_SECONDS",
                str(DEFAULT_HF_MEETING_ANALYSIS_TIMEOUT_SECONDS),
            ),
            "max_tokens": os.getenv(
                "HF_MEETING_ANALYSIS_MAX_TOKENS",
                str(DEFAULT_HF_MEETING_ANALYSIS_MAX_TOKENS),
            ),
            "temperature": os.getenv(
                "HF_MEETING_ANALYSIS_TEMPERATURE",
                str(DEFAULT_HF_MEETING_ANALYSIS_TEMPERATURE),
            ),
        },
    }
    canonical_input = json.dumps(
        cache_input,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    digest = hashlib.sha256(canonical_input.encode("utf-8")).hexdigest()
    return f"meeting_analysis:v{MEETING_ANALYSIS_CACHE_SCHEMA_VERSION}:{digest}"


def _analyze_json_uncached(request: AnalyzeRequest) -> MeetingAnalysisResult:
    result = _analyze_by_provider(request)
    action_items = parse_action_items(request.sections.todos) if request.sections else []
    if not action_items:
        return result

    # 작성자가 액션 아이템 칸에 적은 줄이 To-Do의 정답이다. LLM에 맡기면 논의·결정 문장까지
    # To-Do로 지어내고 체크한 우선순위도 무시하므로, 이 경우에는 결정적으로 대체한다.
    # 요약·결정사항·위험요소는 그대로 LLM 결과를 쓴다.
    return result.model_copy(
        update={
            "todos": build_todos_from_action_items(
                action_items, request.meeting_date, request.participants
            )
        }
    )


def _analyze_by_provider(request: AnalyzeRequest) -> MeetingAnalysisResult:
    provider = os.getenv("MEETING_ANALYSIS_PROVIDER", "auto").lower()
    if provider in {"auto", "huggingface", "hf"} and _huggingface_configured():
        try:
            return analyze_meeting_with_huggingface(request)
        except Exception as exception:
            # errorType 만으로는 401(토큰/권한)·404(모델)·429(레이트리밋)·5xx(서버) 를 구분할 수
            # 없어 운영에서 원인을 알 수 없었다(HF 티어가 12케이스 전부 0점이었는데도 미검출).
            # httpx.HTTPStatusError 는 response 를 들고 있으므로 상태 코드만 꺼낸다 - 본문은
            # 토큰을 에코할 수 있어 절대 로그에 남기지 않는다.
            status_code = getattr(getattr(exception, "response", None), "status_code", None)
            logger.warning(
                "Hugging Face 회의록 분석 실패, Ollama/규칙 기반 분석으로 대체합니다. errorType=%s httpStatus=%s",
                type(exception).__name__,
                status_code if status_code is not None else "N/A",
            )
    elif provider in {"huggingface", "hf"}:
        logger.warning("MEETING_ANALYSIS_PROVIDER=%s 이지만 HF_TOKEN이 없어 Ollama/규칙 기반 분석으로 대체합니다.", provider)

    if provider in {"auto", "huggingface", "hf", "ollama"}:
        try:
            return analyze_meeting_with_ollama(request)
        except Exception as exception:
            logger.warning(
                "Ollama 회의록 분석 실패, 규칙 기반 분석으로 대체합니다. errorType=%s",
                type(exception).__name__,
            )
    return analyze_meeting(request)


@app.post("/api/v1/meetings/analyze", response_model=MeetingAnalysisResult)
async def analyze_upload(
    file: Optional[UploadFile] = File(default=None),
    title: str = Form(default="회의록 AI 분석 회의"),
    meeting_date: Optional[str] = Form(default=None),
    meeting_kind: str = Form(default="정기회의"),
    source_type: str = Form(default="document"),
    participants: List[str] = Form(default=[]),
    _: None = Depends(verify_internal_api_key),
):
    text = ""
    file_name = None
    if file:
        file_name = file.filename
        raw = await file.read()
        text = await asyncio.to_thread(extract_uploaded_text, raw, file_name)
    return analyze_json(
        AnalyzeRequest(
            title=title,
            meeting_date=meeting_date or date.today().isoformat(),
            meeting_kind=meeting_kind,
            source_type=source_type,
            file_name=file_name,
            text=text,
            participants=participants,
        )
    )


@app.post("/api/v1/meetings/transcribe", response_model=AudioTranscribeResult)
async def transcribe_audio(file: UploadFile = File(...), _: None = Depends(verify_internal_api_key)):
    """Spring이 음성 회의록 업로드 시 텍스트만 필요할 때 호출하는 STT 전용 엔드포인트.
    분석까지 함께 하는 /analyze와 달리, 추출된 텍스트만 반환해 Spring 쪽 기존 분석 파이프라인(큐/폴백/알림)을 그대로 재사용할 수 있게 한다."""
    raw = await file.read()
    try:
        text = await asyncio.to_thread(extract_audio_text, raw)
    except DocumentTextExtractionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return AudioTranscribeResult(text=text)


def resolve_participants(request: AnalyzeRequest) -> List[str]:
    participants = [p for p in request.participants if p and p.strip()]
    if not participants:
        participants = ["팀장", "팀원"]
    return participants


def section_sentences(section_text: str, limit: int) -> List[str]:
    """양식 섹션 본문은 이미 해당 항목만 담고 있으므로 키워드 필터 없이 문장만 잘라 쓴다.

    섹션이 비어 있으면 빈 리스트를 돌려주고, 호출부가 기존 키워드 방식으로 폴백한다.
    """
    if not section_text or not section_text.strip():
        return []
    results: List[str] = []
    for sentence in split_sentences(section_text):
        if len(sentence) < 6:
            continue
        results.append(shorten(sentence, 120))
        if len(results) >= limit:
            break
    return results


# 양식의 액션 아이템 표에서 사용자가 체크한 우선순위. "[v] 긴급" 처럼 대괄호 안에 표시한다.
_PRIORITY_LABELS = {"긴급": "HIGH", "보통": "MEDIUM", "낮음": "LOW"}
_CHECKED_PRIORITY_PATTERN = re.compile(r"\[\s*[vVxXoO✓√]\s*\]\s*(긴급|보통|낮음)")
_PRIORITY_ROW_PATTERN = re.compile(r"\[[^\]]*\]\s*(?:긴급|보통|낮음)")


def parse_action_items(todos_section: str) -> List[tuple]:
    """액션 아이템 표를 (체크된 우선순위, 내용) 쌍으로 읽는다.

    docx 표는 행 순서대로 셀마다 한 줄로 풀리므로 "우선순위 줄 → 내용 줄" 순으로 나온다.
    내용을 안 적은 빈 행은 우선순위 줄만 남으므로 버린다. 우선순위 줄 없이 그냥 적은
    문장도 내용으로 받아준다(체크를 안 했을 뿐 할 일은 할 일이다).
    """
    if not todos_section or not todos_section.strip():
        return []

    items: List[tuple] = []
    pending_priority: Optional[str] = None
    saw_priority_row = False

    for line in todos_section.split("\n"):
        stripped = line.strip()
        if not stripped:
            continue
        if _PRIORITY_ROW_PATTERN.search(stripped):
            checked = _CHECKED_PRIORITY_PATTERN.search(stripped)
            pending_priority = _PRIORITY_LABELS[checked.group(1)] if checked else None
            saw_priority_row = True
            continue
        items.append((pending_priority, stripped))
        pending_priority = None

    # 우선순위 줄이 하나도 없으면 양식 표가 아니라 자유 서술이다. 그대로 내용만 넘긴다.
    if not saw_priority_row:
        return [(None, text) for _, text in items]
    return items


def build_todos_from_action_items(
    action_items: List[tuple],
    meeting_date: str,
    participants: Optional[List[str]] = None,
) -> List[MeetingTodo]:
    """양식의 액션 아이템 칸에 적힌 줄은 하나도 빠짐없이 To-Do로 만든다.

    자유 텍스트에서 To-Do를 찾아낼 때 쓰는 업무 키워드 필터는 여기서 적용하지 않는다.
    작성자가 액션 아이템 칸에 적었다는 것 자체가 "이건 할 일"이라는 선언이라, 키워드에 안 걸린다고
    버리면 사용자가 직접 적은 업무가 조용히 사라진다.

    AI는 대신 담당자·기한·분류를 문장에서 뽑아내는 데 집중한다. 우선순위는 체크한 값을 쓰고,
    체크하지 않았으면 MEDIUM으로 둔다.
    """
    try:
        base_date = date.fromisoformat(meeting_date)
    except (TypeError, ValueError):
        base_date = date.today()

    allowed_names = _allowed_assignee_names(participants or [])
    todos: List[MeetingTodo] = []
    for priority, sentence in action_items:
        slot_assignee, title_source, due_slot = split_todo_cell(sentence)
        # 양식이 정한 "누가" 칸이 문장 추출보다 우선한다. 작성자가 지정 칸에 적은 것이
        # 문장에서 유추한 것보다 확실하고, "담당 미정"이라고 적은 것도 하나의 지정이다.
        assignee = slot_assignee if slot_assignee is not None else extract_assignee_candidate(sentence)
        if allowed_names is not None and assignee not in allowed_names:
            assignee = ""
        # 제목에는 "무엇을" 칸만 쓴다. description·evidence_text 는 원문을 지킨다 -
        # 회의록에 뭐라고 적혔는지 되짚을 수 없게 되면 안 된다.
        todos.append(
            MeetingTodo(
                title=shorten(clean_todo_title(title_source) or title_source, 44),
                description=sentence,
                assignee_candidate=assignee,
                # 기한 칸이 있으면 그 값이 우선한다. 칸 밖의 날짜는 서술이므로 기존 방어막
                # (문맥 키워드 확인)을 그대로 통과해야 마감일이 된다.
                due_date=_due_date_from_slot(due_slot, meeting_date)
                or sanitize_due_date(
                    extract_due_date_candidate(sentence, base_date.year), sentence, meeting_date
                ),
                priority=priority or "MEDIUM",
                category=infer_category(sentence),
                evidence_text=shorten(sentence, _EVIDENCE_MAX_LEN),
            )
        )
    return todos


def analyze_meeting(request: AnalyzeRequest) -> MeetingAnalysisResult:
    raw_text = request.text or request.title
    text = normalize_text(raw_text)
    participants = resolve_participants(request)
    sections = request.sections

    # 양식 문서는 "이 문단이 결정사항"임을 알 수 있으므로 키워드 추측 없이 해당 섹션을 그대로 쓴다.
    decisions = section_sentences(sections.decisions, 5) if sections else []
    if not decisions:
        decisions = extract_sentences(text, ["확정", "결정", "통일", "진행", "사용", "구성"], 5)
    if not decisions:
        decisions = [
            "회의록 분석 결과를 요약, 결정사항, To-Do, 위험요소로 구조화한다.",
            "생성된 To-Do는 팀장 검토 후 업무 보드에 등록한다.",
        ]

    risks = section_sentences(sections.issues, 4) if sections else []
    if not risks:
        risks = extract_sentences(text, ["위험", "지연", "부족", "오류", "실패", "불안정", "촉박"], 4)
    if not risks:
        risks = ["담당자와 마감일이 명확하지 않은 업무는 일정 지연으로 이어질 수 있다."]

    # 원본 텍스트(줄바꿈 보존)에서 "이름: 발언" 화자 형식을 먼저 시도하고, 없으면 공백-정규화 텍스트의
    # 키워드 문장 추출로 대체한다. normalize_text()는 줄바꿈을 공백으로 뭉개므로 화자 구분에 쓸 수 없다.
    # 양식 문서라면 액션 아이템 섹션으로 범위를 좁혀, 논의 문장이 업무로 잘못 잡히는 것을 막는다.
    # 우선순위 체크 줄은 내용이 아니므로 빼고 문장만 AI에 넘긴다 — AI는 담당자·기한·분류 추출에 집중하고,
    # 우선순위는 사용자가 체크한 값으로 덮어쓴다.
    action_items = parse_action_items(sections.todos) if sections else []
    if action_items:
        todos = build_todos_from_action_items(action_items, request.meeting_date, request.participants)
    else:
        todos = build_todos(raw_text, text, request.meeting_date, request.participants)
    summary = (
        f"{request.title} 내용을 분석해 핵심 결정사항 {len(decisions)}건, "
        f"업무 후보 {len(todos)}건, 위험요소 {len(risks)}건을 추출했습니다."
    )

    return MeetingAnalysisResult(
        summary=summary,
        decisions=decisions,
        todos=todos,
        risks=risks,
        keywords=build_keywords(text, request.source_type),
        meeting_meta=MeetingMeta(
            title=request.title,
            meeting_date=request.meeting_date,
            participants=participants,
        ),
    )


_VALID_PRIORITIES = {"HIGH", "MEDIUM", "LOW"}
_VALID_CATEGORIES = {
    "FRONTEND",
    "BACKEND",
    "AI",
    "DATABASE",
    "QA",
    "DOCUMENT",
    "PRESENTATION",
    "ETC",
}


class DocumentTextExtractionError(ValueError):
    pass


def analyze_meeting_with_ollama(request: AnalyzeRequest) -> MeetingAnalysisResult:
    host = os.getenv("OLLAMA_HOST", DEFAULT_OLLAMA_HOST)
    model = os.getenv("MEETING_ANALYSIS_MODEL", DEFAULT_MEETING_ANALYSIS_MODEL)
    timeout_seconds = _get_env_float("MEETING_ANALYSIS_TIMEOUT_SECONDS", DEFAULT_MEETING_ANALYSIS_TIMEOUT_SECONDS)
    temperature = float(os.getenv("OLLAMA_ANALYSIS_TEMPERATURE", str(DEFAULT_OLLAMA_ANALYSIS_TEMPERATURE)))
    num_predict = int(os.getenv("MEETING_ANALYSIS_NUM_PREDICT", str(DEFAULT_MEETING_ANALYSIS_NUM_PREDICT)))
    keep_alive = os.getenv("MEETING_ANALYSIS_KEEP_ALIVE", DEFAULT_MEETING_ANALYSIS_KEEP_ALIVE)

    client = ollama.Client(host=host, timeout=timeout_seconds)
    if not _ollama_model_available(client, model):
        raise RuntimeError(f"Ollama model is not available: {model}")
    response = client.chat(
        model=model,
        messages=[{"role": "user", "content": build_ollama_prompt(request)}],
        format="json",
        options={
            "temperature": temperature,
            "num_ctx": 4096,
            "num_predict": num_predict,
        },
        keep_alive=keep_alive,
    )
    raw = response["message"]["content"]
    result = parse_ollama_analysis_response(raw, request)
    logger.info("Ollama 회의록 분석 성공. model=%s", model)
    return result


def analyze_meeting_with_huggingface(request: AnalyzeRequest) -> MeetingAnalysisResult:
    token = os.getenv("HF_TOKEN") or os.getenv("HUGGINGFACEHUB_API_TOKEN")
    if not token:
        raise RuntimeError("HF_TOKEN is not configured.")

    endpoint = os.getenv("HF_MEETING_ANALYSIS_ENDPOINT", HF_CHAT_COMPLETIONS_URL)
    model = os.getenv("HF_MEETING_ANALYSIS_MODEL", DEFAULT_HF_MEETING_ANALYSIS_MODEL)
    timeout_seconds = _get_env_float("HF_MEETING_ANALYSIS_TIMEOUT_SECONDS", DEFAULT_HF_MEETING_ANALYSIS_TIMEOUT_SECONDS)
    max_tokens = int(os.getenv("HF_MEETING_ANALYSIS_MAX_TOKENS", str(DEFAULT_HF_MEETING_ANALYSIS_MAX_TOKENS)))
    temperature = float(
        os.getenv("HF_MEETING_ANALYSIS_TEMPERATURE", str(DEFAULT_HF_MEETING_ANALYSIS_TEMPERATURE))
    )

    payload = {
        "model": model,
        "messages": [{"role": "user", "content": build_ollama_prompt(request)}],
        "stream": False,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    with httpx.Client(timeout=timeout_seconds) as client:
        response = client.post(endpoint, headers=headers, json=payload)
        response.raise_for_status()
        body = response.json()

    raw = body["choices"][0]["message"]["content"]
    result = parse_ollama_analysis_response(raw, request)
    logger.info("Hugging Face 회의록 분석 성공. model=%s", model)
    return result


def _huggingface_configured() -> bool:
    return bool(os.getenv("HF_TOKEN") or os.getenv("HUGGINGFACEHUB_API_TOKEN"))


def build_section_hint(sections: Optional[MeetingSections]) -> str:
    """양식 문서일 때, 모델이 섹션 경계를 추측하지 않도록 구조를 명시한다."""
    if sections is None:
        return ""
    labeled = [
        ("논의 내용", sections.discussion),
        ("결정 사항", sections.decisions),
        ("액션 아이템", sections.todos),
        ("특이사항·리스크", sections.issues),
    ]
    filled = [f"[{label}]\n{body.strip()}" for label, body in labeled if body and body.strip()]
    if not filled:
        return ""
    body = "\n\n".join(filled)
    return (
        "\n이 회의록은 정해진 양식으로 작성되어 섹션이 구분되어 있습니다. "
        "각 항목은 반드시 해당 섹션 안에서만 뽑으세요. "
        "액션 아이템의 '[v] 긴급' 같은 표기는 작성자가 직접 고른 우선순위이니 임의로 바꾸지 말고, "
        "담당자·기한·업무 내용을 문장에서 정확히 뽑아내는 데 집중하세요.\n\n" + body + "\n"
    )


def build_ollama_prompt(request: AnalyzeRequest) -> str:
    participants = ", ".join(resolve_participants(request))
    text = _limit_text_for_local_model(request.text or request.title)
    section_hint = build_section_hint(request.sections)
    return f"""다음은 회의록 원문입니다. 이 내용을 분석해서 아래 JSON 스키마로만 응답하세요. 스키마에 없는 다른 텍스트는 출력하지 마세요.

회의 제목: {request.title}
회의 일자: {request.meeting_date}
선택된 참석자: {participants}
{section_hint}
회의록 원문:
{text}

JSON 스키마:
{{
  "summary": "회의 내용 한두 문장 요약",
  "decisions": ["결정사항 문장", "..."],
  "todos": [
    {{
      "title": "12~25자 내외의 짧고 명확한 업무명(명사형)",
      "description": "업무 상세 설명",
      "assignee_candidate": "담당자 이름 또는 빈 문자열",
      "due_date": "YYYY-MM-DD 또는 null",
      "priority": "HIGH 또는 MEDIUM 또는 LOW",
      "category": "FRONTEND 또는 BACKEND 또는 AI 또는 DATABASE 또는 QA 또는 DOCUMENT 또는 PRESENTATION 또는 ETC",
      "evidence_text": "이 업무의 근거가 된 회의록 원문 문장/발언 일부"
    }}
  ],
  "risks": ["위험요소 문장", "..."],
  "keywords": ["키워드", "..."]
}}

담당자(assignee_candidate) 규칙 - 반드시 지킬 것:
1. 회의록 내용에서 특정 인물이 명시적으로 담당한다고 말한 업무만 그 사람 이름을 assignee_candidate로 적는다.
   예: "제가 하겠습니다", "저는 OO를 맡겠습니다" -> 발언자 본인. "OO가 맡겠습니다", "OO가 구현합니다", "담당: OO" -> 명시된 OO.
   "OO: 업무 내용" 처럼 이름 다음에 콜론(:)으로 업무를 나열한 목록 형식도 그 이름을 담당자로 인정한다.
   예: "지수: 프론트엔드 크래시 재현 테스트를 진행한다." -> assignee_candidate는 "지수".
2. 위와 같이 명시적으로 담당을 밝힌 경우가 아니면 assignee_candidate는 반드시 빈 문자열("")로 남긴다.
3. 선택된 참석자 목록에 있다는 이유만으로 아무에게나 업무를 임의 배정하지 않는다.
4. 회의록에 실제로 등장하지 않는 이름을 만들어내지 않는다.
5. 특정 인물이나 목록의 첫 번째 참석자에게 fallback으로 몰아서 배정하지 않는다. 한 사람에게 모든 업무를 배정하는 것은 금지된다.

title 규칙 - 반드시 지킬 것:
1. title은 회의록 원문 발언을 그대로 복사하지 않는다.
2. "저는", "제가", "~하겠습니다", "~진행하겠습니다", "~맡겠습니다" 같은 발언체 표현을 제거하고, "~하기", "~발급", "~작성", "~제출", "~검토" 처럼 짧은 동사형 명사(동명사) 어미로 끝나는 업무명으로 정리한다.
3. 길이는 12~25자 내외로 짧게 작성한다.
4. 예:
   - "저는 회의록 AI 분석을 맡겠습니다" -> "회의록 AI 분석하기"
   - "임베딩 모델을 바꾸는 방향으로 진행하겠습니다" -> "임베딩 모델 변경하기"
   - "제가 참가 신청서 서류를 발급받아 오겠습니다" -> "참가 신청서 발급받기"
   - "보고서 초안을 다음 주까지 작성해서 제출하겠습니다" -> "보고서 초안 작성 및 제출하기"

evidence_text 규칙 - 반드시 지킬 것:
1. 이 업무가 어떤 발언/문장에서 나왔는지 회의록 원문 그대로(화자 포함) 인용한다.
   예: "박지수: 저는 회의록 AI 분석을 맡겠습니다."
2. 회의록 원문에 없는 내용을 지어내지 않는다.
3. 근거가 될 만한 발언을 찾을 수 없으면 빈 문자열("")로 남긴다.

마감일/결정사항 규칙 - 반드시 지킬 것:
1. due_date는 회의록 원문에 명시적인 날짜와 마감/완료/제출/기한 표현이 함께 있을 때만 적는다.
   예: "8/10까지 완료", "8월 10일 제출", "2026-08-10 마감"
2. 회의 일자나 현재 날짜를 기준으로 마감일을 추정하지 않는다.
3. 원문에 없는 날짜, 기간, 완료 예정일을 결정사항이나 업무에 추가하지 않는다.
4. "개발팀", "팀 전체"처럼 개인 이름이 아닌 주체는 담당자로 적지 말고 assignee_candidate를 빈 문자열로 둔다.
"""


def _get_env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except ValueError:
        return default


def _limit_text_for_local_model(text: str) -> str:
    max_chars = int(os.getenv("MEETING_ANALYSIS_MAX_CHARS", str(DEFAULT_MEETING_ANALYSIS_MAX_CHARS)))
    if len(text) <= max_chars:
        return text
    head = text[: int(max_chars * 0.7)].rstrip()
    tail = text[-int(max_chars * 0.3) :].lstrip()
    return f"{head}\n\n...[회의록 일부 생략: 로컬 모델 분석 속도 최적화]...\n\n{tail}"


def _ollama_model_available(client: ollama.Client, model: str) -> bool:
    response = client.list()
    names = set(_extract_ollama_model_names(response))
    if ":" not in model:
        return any(name == model or name.startswith(f"{model}:") for name in names)
    return model in names


def _extract_ollama_model_names(response) -> List[str]:
    models = response.get("models", []) if isinstance(response, dict) else getattr(response, "models", [])
    names: List[str] = []
    for item in models:
        if isinstance(item, dict):
            name = item.get("name") or item.get("model")
        else:
            name = getattr(item, "name", None) or getattr(item, "model", None)
        if name:
            names.append(str(name))
    return names


def _strip_code_fence(raw: str) -> str:
    trimmed = raw.strip()
    if trimmed.startswith("```"):
        trimmed = re.sub(r"^```[a-zA-Z]*\n?", "", trimmed)
        trimmed = re.sub(r"```\s*$", "", trimmed)
    return trimmed.strip()


def _allowed_assignee_names(participants: List[str]) -> Optional[set[str]]:
    names = {participant.strip() for participant in participants if participant and participant.strip()}
    return names or None


def _sanitize_assignee_candidate(
    candidate: str,
    source_text: str,
    allowed_names: Optional[set[str]] = None,
    evidence_text: str = "",
) -> str:
    """모델이 회의록에 등장하지 않는 이름을 지어내는 것을 막는 안전장치.
    회의록 원문 또는 선택된 참석자 목록에 없는 이름은 미배정(빈 문자열)으로 되돌린다."""
    name = candidate.strip()
    if not name or name not in source_text:
        return ""
    if allowed_names is not None and name not in allowed_names:
        return ""
    if evidence_text and not _has_assignee_task_evidence(name, evidence_text, source_text):
        return ""
    return name


def _has_assignee_task_evidence(name: str, evidence_text: str, source_text: str) -> bool:
    speaker_tasks = [(speaker, sentence) for speaker, sentence in extract_explicit_task_candidates(source_text) if speaker == name]
    if not speaker_tasks:
        return True

    evidence_tokens = _tokenize_for_overlap(evidence_text)
    if name in evidence_text:
        return True
    for _, sentence in speaker_tasks:
        sentence_tokens = _tokenize_for_overlap(sentence)
        if evidence_text.strip() and (evidence_text.strip() in sentence or sentence in evidence_text.strip()):
            return True
        if _has_meaningful_token_overlap(evidence_tokens, sentence_tokens):
            return True
    return False


def _has_meaningful_token_overlap(left_tokens: set[str], right_tokens: set[str]) -> bool:
    exact_overlap = left_tokens & right_tokens
    if len(exact_overlap) >= 2:
        return True

    fuzzy_overlap_count = 0
    for left in left_tokens:
        for right in right_tokens:
            if len(left) >= 2 and len(right) >= 2 and (left in right or right in left):
                fuzzy_overlap_count += 1
                break
    return fuzzy_overlap_count >= 2


def _tokenize_for_overlap(value: str) -> set[str]:
    stopwords = {"저는", "제가", "먼저", "기반", "구현", "하겠습니다", "합니다", "입니다", "것입니다", "결정사항"}
    tokens = set(re.findall(r"[가-힣A-Za-z0-9]{2,}", value))
    return {token for token in tokens if token not in stopwords}


_DATE_CONTEXT_KEYWORDS = {"까지", "전까지", "마감", "완료", "제출", "기한", "추후", "일정"}
_DATEISH_PATTERN = re.compile(
    r"20\d{2}\s*(?:[-./]|년\s*)\s*\d{1,2}\s*(?:[-./]|월\s*)\s*\d{1,2}\s*일?"
    r"|(?<!\d)\d{1,2}\s*[./]\s*\d{1,2}(?!\d)"
    r"|\d{1,2}\s*월\s*\d{1,2}\s*일"
)


def _meeting_year(meeting_date: str) -> int:
    try:
        return date.fromisoformat(meeting_date).year
    except ValueError:
        return date.today().year


def _safe_iso_date(year: int, month: int, day: int) -> Optional[str]:
    try:
        return date(year, month, day).isoformat()
    except ValueError:
        return None


def _normalize_date_token(token: str, meeting_date: str) -> Optional[str]:
    compact = token.strip()
    full = re.match(
        r"^(20\d{2})\s*(?:[-./]|년\s*)\s*(\d{1,2})\s*(?:[-./]|월\s*)\s*(\d{1,2})\s*일?$",
        compact,
    )
    if full:
        return _safe_iso_date(int(full.group(1)), int(full.group(2)), int(full.group(3)))

    slash = re.match(r"^(\d{1,2})\s*[./]\s*(\d{1,2})$", compact)
    if slash:
        return _safe_iso_date(_meeting_year(meeting_date), int(slash.group(1)), int(slash.group(2)))

    korean = re.match(r"^(\d{1,2})\s*월\s*(\d{1,2})\s*일$", compact)
    if korean:
        return _safe_iso_date(_meeting_year(meeting_date), int(korean.group(1)), int(korean.group(2)))
    return None


def _extract_due_date_mentions(text: str, meeting_date: str) -> set[str]:
    """원문에서 실제 마감/완료/제출 맥락에 있는 날짜만 ISO로 모은다.
    회의 일자 헤더처럼 단순히 적힌 날짜를 업무 마감일로 오해하지 않기 위한 방어막이다."""
    found: set[str] = set()
    for match in _DATEISH_PATTERN.finditer(text):
        normalized = _normalize_date_token(match.group(0), meeting_date)
        if not normalized:
            continue
        context = text[max(0, match.start() - 24) : min(len(text), match.end() + 24)]
        if any(keyword in context for keyword in _DATE_CONTEXT_KEYWORDS):
            found.add(normalized)
    return found


def _extract_any_date_mentions(text: str, meeting_date: str) -> set[str]:
    found: set[str] = set()
    for match in _DATEISH_PATTERN.finditer(text):
        normalized = _normalize_date_token(match.group(0), meeting_date)
        if normalized:
            found.add(normalized)
    return found


def sanitize_due_date(candidate: object, source_text: str, meeting_date: str) -> Optional[str]:
    if not isinstance(candidate, str) or not candidate.strip():
        return None
    normalized = _normalize_date_token(candidate.strip(), meeting_date)
    if not normalized:
        return None
    if normalized not in _extract_due_date_mentions(source_text, meeting_date):
        logger.info("회의록 원문에 없는 마감일 후보를 제거합니다. due_date=%s", normalized)
        return None
    return normalized


def _has_unsupported_date_claim(statement: str, source_text: str, meeting_date: str) -> bool:
    statement_dates = _extract_any_date_mentions(statement, meeting_date)
    if not statement_dates:
        return False
    source_dates = _extract_any_date_mentions(source_text, meeting_date)
    if not statement_dates.issubset(source_dates):
        return True
    if any(keyword in statement for keyword in _DATE_CONTEXT_KEYWORDS):
        return not statement_dates.issubset(_extract_due_date_mentions(source_text, meeting_date))
    return False


def _is_schema_placeholder(statement: str) -> str:
    """프롬프트 JSON 스키마 예시의 자리표시자("...", "…", "결정사항 문장")를 그대로 받아쓴 것인지."""
    stripped = statement.strip().strip("\"'")
    if not stripped:
        return True
    if set(stripped) <= {".", "…", "·", "-"}:
        return True
    return stripped in {"결정사항 문장", "위험요소 문장", "키워드"}


def sanitize_model_statements(statements: object, source_text: str, meeting_date: str) -> List[str]:
    safe: List[str] = []
    for item in statements or []:
        statement = str(item).strip()
        if not statement:
            continue
        if _is_schema_placeholder(statement):
            # 프롬프트의 JSON 스키마 예시에 있는 "..." 를 모델이 그대로 따라 적는 경우가 있다.
            continue
        if _has_unsupported_date_claim(statement, source_text, meeting_date):
            logger.info("회의록 원문 근거가 부족한 날짜 포함 문장을 제거합니다. statement=%s", statement)
            continue
        safe.append(statement)
    return safe


def extract_uploaded_text(raw: bytes, file_name: Optional[str] = None) -> str:
    """FastAPI 직접 업로드 경로에서도 문서 본문을 실제로 읽는다.
    Spring 경유 분석은 보통 analyze-json을 쓰지만, /analyze를 직접 호출하는 Swagger 테스트도 같은 품질이어야 한다."""
    name = (file_name or "").lower()
    try:
        if name.endswith(".pdf"):
            return extract_pdf_text(raw)
        if name.endswith(".docx"):
            return extract_docx_text(raw)
        if name.endswith(AUDIO_FILE_EXTENSIONS):
            return extract_audio_text(raw)
        return raw.decode("utf-8", errors="ignore").strip()
    except DocumentTextExtractionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def extract_pdf_text(raw: bytes) -> str:
    try:
        import pdfplumber

        with pdfplumber.open(BytesIO(raw)) as pdf:
            pages = [page.extract_text() or "" for page in pdf.pages]
        text = "\n".join(page.strip() for page in pages if page.strip()).strip()
        if not text:
            raise DocumentTextExtractionError("PDF에서 분석할 텍스트를 추출하지 못했습니다.")
        return text
    except DocumentTextExtractionError:
        raise
    except ImportError as exc:
        logger.exception("PDF 텍스트 추출 의존성 누락")
        raise DocumentTextExtractionError("PDF 분석에 필요한 서버 의존성이 설치되지 않았습니다.") from exc
    except Exception as exc:
        logger.exception("PDF 텍스트 추출 실패")
        raise DocumentTextExtractionError("PDF 텍스트 추출에 실패했습니다.") from exc


def extract_docx_text(raw: bytes) -> str:
    try:
        from docx import Document

        document = Document(BytesIO(raw))
        chunks: List[str] = []
        chunks.extend(paragraph.text.strip() for paragraph in document.paragraphs if paragraph.text.strip())
        for table in document.tables:
            for row in table.rows:
                row_text = " ".join(cell.text.strip() for cell in row.cells if cell.text.strip())
                if row_text:
                    chunks.append(row_text)
        text = "\n".join(chunks).strip()
        if not text:
            raise DocumentTextExtractionError("DOCX에서 분석할 텍스트를 추출하지 못했습니다.")
        return text
    except DocumentTextExtractionError:
        raise
    except ImportError as exc:
        logger.exception("DOCX 텍스트 추출 의존성 누락")
        raise DocumentTextExtractionError("DOCX 분석에 필요한 서버 의존성이 설치되지 않았습니다.") from exc
    except Exception as exc:
        logger.exception("DOCX 텍스트 추출 실패")
        raise DocumentTextExtractionError("DOCX 텍스트 추출에 실패했습니다.") from exc


_whisper_model = None


def get_whisper_model():
    global _whisper_model
    if _whisper_model is None:
        from faster_whisper import WhisperModel

        _whisper_model = WhisperModel(
            os.getenv("WHISPER_MODEL_SIZE", DEFAULT_WHISPER_MODEL_SIZE),
            device=os.getenv("WHISPER_DEVICE", DEFAULT_WHISPER_DEVICE),
            compute_type=os.getenv("WHISPER_COMPUTE_TYPE", DEFAULT_WHISPER_COMPUTE_TYPE),
        )
    return _whisper_model


def extract_audio_text(raw: bytes) -> str:
    try:
        model = get_whisper_model()
        language = os.getenv("WHISPER_LANGUAGE", DEFAULT_WHISPER_LANGUAGE)
        segments, _ = model.transcribe(BytesIO(raw), language=language)
        text = " ".join(segment.text.strip() for segment in segments if segment.text.strip()).strip()
        if not text:
            raise DocumentTextExtractionError("음성 파일에서 텍스트를 추출하지 못했습니다.")
        return text
    except DocumentTextExtractionError:
        raise
    except ImportError as exc:
        logger.exception("음성 인식(STT) 의존성 누락")
        raise DocumentTextExtractionError("음성 인식에 필요한 서버 의존성이 설치되지 않았습니다.") from exc
    except Exception as exc:
        logger.exception("음성 파일 텍스트 추출 실패")
        raise DocumentTextExtractionError("음성 파일 텍스트 추출에 실패했습니다.") from exc


_TITLE_LEADING_PATTERNS = [
    re.compile(r"^(저는|제가|우선|먼저)\s+"),
    re.compile(r"^[가-힣]{2,4}(?:은|는|이|가)\s+"),
    re.compile(r"^다음 회의 전까지\s+"),
]
_TITLE_TRAILING_SUFFIXES = [
    "해보겠다고 말했다",
    "하겠다고 말했다",
    "검토한다고 말했다",
    "확인한다고 말했다",
    "점검한다고 말했다",
    "진행한다고 말했다",
    "작성한다고 말했다",
    "구현한다고 말했다",
    "개선한다고 말했다",
    "정리한다고 말했다",
    "확인하기로 하였다",
    "점검하기로 하였다",
    "검토하기로 하였다",
    "진행하겠습니다",
    "구현하겠습니다",
    "정리하겠습니다",
    "작성하겠습니다",
    "만들겠습니다",
    "보여주겠습니다",
    "잡겠습니다",
    "맡겠습니다",
    "하겠습니다",
    "하겠음",
    "겠습니다",
    "확인하고",
    "점검하고",
    "검토하고",
    "진행하고",
    "작성하고",
    "구현하고",
    "개선하고",
    "확인한다",
    "점검한다",
    "검토한다",
    "진행한다",
    "작성한다",
    "구현한다",
    "개선한다",
    "합니다",
    "습니다",
]
_TITLE_TRAILING_FILLERS = ["방향으로", "쪽으로", "식으로", "예정입니다", "예정"]
_TITLE_MAX_LEN = 25
_EVIDENCE_MAX_LEN = 160


# 업무명은 "~한다"가 아니라 "~ 진행"처럼 명사형으로 끝나야 보드 카드에서 읽기 좋다.
# 프롬프트로 명사형을 요구해도 LLM이 서술형으로 돌려주는 경우가 있어 마지막에 규칙으로 보정한다.
_VERB_ENDING_RE = re.compile(
    r"(?P<stem>[가-힣A-Za-z0-9)\]]+?)\s*"
    r"(?:하기로\s*(?:함|했다|하였다)|하기로\s*하다|"
    r"한다|합니다|하였다|했다|하겠다|하겠습니다|하기|할\s*것|해야\s*(?:한다|함)|하자|하시죠)$"
)


def _to_noun_style_title(title: str) -> str:
    """서술형 어미를 명사형으로 바꾼다. 예: "로그인 API를 구현한다" -> "로그인 API 구현"."""
    stripped = title.strip()
    if not stripped:
        return title
    match = _VERB_ENDING_RE.search(stripped)
    if not match:
        return title
    stem = match.group("stem").strip()
    if not stem:
        return title
    head = stripped[: match.start()].strip()
    # 목적격 조사가 남으면 "API를 구현"처럼 어색해지므로 떼어낸다.
    if head and head[-1] in "을를":
        head = head[:-1].strip()
    rebuilt = f"{head} {stem}".strip() if head else stem
    # 어간만 남아 의미가 사라지는 경우(예: "진행")는 원본을 유지한다.
    return rebuilt if len(rebuilt) >= 2 else title


# 양식의 실행항목 칸은 "내용 (누가 · 무엇을 · 언제까지)"로 적으라고 안내한다. 세 칸을 · 로
# 나누는 것은 우리가 정한 규격인데 파서가 칸 전체를 제목으로 써서, 보드에
# "담당 미정 · 삭제된 심사자 계정…"처럼 담당자 칸이 제목에 박혔다.
#
# 제목은 문자열이고 배정은 별개 필드다. 나중에 사람을 배정해도 제목의 "담당 미정"은 그대로
# 남아 둘이 영원히 어긋난다. 어시스턴트가 그 글자를 읽고 "담당자는 미정입니다"라고 답한 것이
# 그 결과였다(2026-08-04 운영 실측).
_TODO_FIELD_SEPARATOR = "·"
_UNASSIGNED_MARKERS = {"담당 미정", "담당미정", "미정", "미배정", "담당자 미정", "tbd", "-", "?"}
# 이름 자리는 사람 이름이나 "담당 미정" 정도가 들어가는 짧은 칸이다. 길면 작성자가 양식을
# 안 지키고 문장을 · 로 이어 적은 것이므로 건드리지 않는다 - 잘라내면 업무 내용의 앞부분이
# 소리 없이 사라진다.
_ASSIGNEE_SLOT_MAX_LEN = 12
_ASSIGNEE_SLOT_NAME_PATTERN = re.compile(r"^[가-힣]{2,4}(?:님|씨)?$")


def _looks_like_assignee_slot(segment: str) -> bool:
    text = segment.strip()
    if not text or len(text) > _ASSIGNEE_SLOT_MAX_LEN:
        return False
    return text.lower() in _UNASSIGNED_MARKERS or bool(_ASSIGNEE_SLOT_NAME_PATTERN.match(text))


def split_todo_cell(sentence: str) -> tuple[Optional[str], str, Optional[str]]:
    """실행항목 칸을 (누가, 무엇을, 언제까지)로 나눈다.

    세 소비처(제목·담당자·마감일)가 같은 분해를 봐야 한다. 각자 나누면 한쪽만 고쳤을 때
    제목에서는 뗀 칸을 담당자 쪽은 그대로 읽는 식으로 조용히 어긋난다.

    누가:   이름 / "" (작성자가 "담당 미정"이라고 명시) / None (자리 없음)
    무엇을: 제목으로 쓸 문자열. 떼고 나서 남는 게 없으면 원문을 지킨다
    언제까지: 기한 칸 원문 / None
    """
    if _TODO_FIELD_SEPARATOR not in sentence:
        return None, sentence, None

    parts = [part.strip() for part in sentence.split(_TODO_FIELD_SEPARATOR)]

    assignee: Optional[str] = None
    if _looks_like_assignee_slot(parts[0]):
        head = parts[0]
        assignee = "" if head.lower() in _UNASSIGNED_MARKERS else head.rstrip("님씨")
        parts = parts[1:]

    # 칸이 둘 이상 남았을 때만 마지막을 뗀다. 하나뿐이면 그게 업무 내용이다.
    # 담당자 칸을 이미 확인했다면 양식을 지킨 문서이므로 마지막 칸은 기한으로 본다.
    due: Optional[str] = None
    if len(parts) >= 2 and (assignee is not None or _looks_like_due_slot(parts[-1])):
        due = parts[-1]
        parts = parts[:-1]

    content = f" {_TODO_FIELD_SEPARATOR} ".join(part for part in parts if part)
    return assignee, content or sentence, due


def resolve_assignee_slot(sentence: str) -> Optional[str]:
    """실행항목 칸의 "누가"를 읽는다. 세 가지를 구분하지 않으면 작성자 의도를 뒤집는다."""
    return split_todo_cell(sentence)[0]


# 양식의 "언제까지" 칸에 적힌 날짜는 추측이 아니라 선언이다. sanitize_due_date 는 마감·완료
# 같은 문맥 키워드가 곁에 있어야 마감일로 인정하는데, 그건 회의 일자 헤더를 마감일로 오인하지
# 않으려는 자유 서술용 방어막이다. 지정된 칸 안에서는 그 방어막이 필요 없고, 있으면 양식대로
# 날짜만 적은 사용자의 마감일이 조용히 사라진다.
def _due_date_from_slot(due_text: Optional[str], meeting_date: str) -> Optional[str]:
    if not due_text:
        return None
    match = _DATEISH_PATTERN.search(due_text)
    if not match:
        # "배포 당일"처럼 사람은 알아도 날짜가 아닌 표현이다. 지어내지 않는다.
        return None
    return _normalize_date_token(match.group(0), meeting_date)


# 기한 칸은 "배포 당일", "심사 일정 전까지", "8/10", "미정"처럼 적힌다. 날짜로 파싱되거나
# 기한을 가리키는 말이면 기한 칸으로 본다. 길면 업무 내용이므로 건드리지 않는다.
_DUE_SLOT_MAX_LEN = 20
_DUE_SLOT_KEYWORD_PATTERN = re.compile(
    r"(까지|당일|오늘|내일|모레|이번\s*주|다음\s*주|월말|주말|분기|미정|미배정|tbd)", re.IGNORECASE
)


def _looks_like_due_slot(segment: str) -> bool:
    text = segment.strip()
    if not text or len(text) > _DUE_SLOT_MAX_LEN:
        return False
    return bool(_DATEISH_PATTERN.search(text) or _DUE_SLOT_KEYWORD_PATTERN.search(text))


def strip_assignee_slot(sentence: str) -> str:
    """실행항목 칸에서 업무 내용("무엇을")만 남긴다.

    양식은 "누가 · 무엇을 · 언제까지"다. 담당자와 기한은 각각 별도 필드로 저장되므로
    제목에 남을 이유가 없다. 기한을 남겨두면 44자 상한에 걸려 "…확인 ·…" 같은 꼬리가 된다.

    양식대로 적히지 않았으면 원문을 그대로 돌려준다. 떼어낸 뒤 남는 내용이 없을 때도
    마찬가지다 - 제목이 빈 문자열이 되느니 지저분한 편이 낫다.
    """
    return split_todo_cell(sentence)[1]


def clean_todo_title(raw_title: str) -> str:
    """LLM/규칙 기반 추출이 회의록 발언을 그대로 title로 반환하는 것을 막는 최소 보정.
    발언체 표현(저는/제가/~하겠습니다 등)을 제거하고 명사형 업무명에 가깝게 다듬는다."""
    title = raw_title.strip().rstrip(".!?~ ")
    for pattern in _TITLE_LEADING_PATTERNS:
        title = pattern.sub("", title).strip()
    title = re.sub(
        r"(을|를)\s+(확인|점검|검토|정리|작성|구현|개선|연결|테스트|표시|반영|처리|준비|설계)(?:하고|한다|하였다|하겠다|하겠습니다|해보겠다고 말했다)?\s*$",
        r" \2",
        title,
    )
    for suffix in _TITLE_TRAILING_SUFFIXES:
        if title.endswith(suffix):
            title = title[: -len(suffix)].strip()
            break
    title = re.sub(r"(을|를)\s+(확인|점검|검토|정리|작성|구현|개선|연결|테스트|표시|반영|처리|준비|설계)\s*$", r" \2", title)
    for filler in _TITLE_TRAILING_FILLERS:
        if title.endswith(filler):
            title = title[: -len(filler)].strip()
            break
    if title and title[-1] in "을를":
        title = title[:-1].strip()
    title = _to_noun_style_title(title)
    title = title.rstrip(".!?~ ")
    if len(title) > _TITLE_MAX_LEN:
        title = shorten(title, _TITLE_MAX_LEN)
    return title or raw_title.strip()


def _resolve_evidence_text(raw_evidence: str, title: str, description: str, source_text: str) -> str:
    """LLM이 준 근거가 회의록 원문에 실제로 있는 인용인지 확인하고, 없거나 비어 있으면
    화자 발언/문장 추출 결과에서 title/description과 겹치는 근거를 찾아 보정한다."""
    candidate = raw_evidence.strip()
    if candidate and candidate in source_text:
        return shorten(candidate, _EVIDENCE_MAX_LEN)
    return _infer_evidence_from_source(title, description, source_text)


def _infer_evidence_from_source(title: str, description: str, source_text: str) -> str:
    target_tokens = _tokenize_for_overlap(f"{title} {description}")
    if not target_tokens:
        return ""
    for speaker, sentence in extract_speaker_task_candidates(source_text):
        if _has_meaningful_token_overlap(target_tokens, _tokenize_for_overlap(sentence)):
            quote = f"{speaker}: {sentence}" if speaker else sentence
            return shorten(quote, _EVIDENCE_MAX_LEN)
    for speaker, sentence in extract_formal_task_candidates(source_text):
        if _has_meaningful_token_overlap(target_tokens, _tokenize_for_overlap(sentence)):
            quote = f"{speaker}: {sentence}" if speaker else sentence
            return shorten(quote, _EVIDENCE_MAX_LEN)
    for sentence in split_sentences(source_text):
        if _has_meaningful_token_overlap(target_tokens, _tokenize_for_overlap(sentence)):
            return shorten(sentence, _EVIDENCE_MAX_LEN)
    return ""


def parse_ollama_analysis_response(raw: str, request: AnalyzeRequest) -> MeetingAnalysisResult:
    payload = json.loads(_strip_code_fence(raw))
    if not isinstance(payload, dict):
        raise ValueError("Ollama 응답이 JSON 객체가 아닙니다.")

    summary = str(payload.get("summary") or "").strip()
    if not summary:
        raise ValueError("Ollama 응답에 summary가 없습니다.")

    source_text = request.text or request.title
    todos: List[MeetingTodo] = []
    for item in payload.get("todos") or []:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip()
        description = str(item.get("description") or "").strip()
        if not title and not description:
            continue

        priority = str(item.get("priority") or "MEDIUM").upper()
        if priority not in _VALID_PRIORITIES:
            priority = "MEDIUM"
        category = str(item.get("category") or "ETC").upper()
        if category not in _VALID_CATEGORIES:
            category = "ETC"
        assignee_candidate = _sanitize_assignee_candidate(
            str(item.get("assignee_candidate") or ""),
            source_text,
            _allowed_assignee_names(request.participants),
            f"{title} {description}",
        )
        # 프롬프트로 "원문을 그대로 베끼지 말라"고 지시하지만 모델은 자주 어긴다. 베낀 경우
        # 규칙 경로와 똑같이 담당자 칸이 제목에 실려 나가므로 여기서도 떼어낸다.
        # description 폴백도 원문 칸이라 같은 처리가 필요하다.
        title_source = strip_assignee_slot(title) if title else ""
        cleaned_title = clean_todo_title(title_source) if title_source else ""
        raw_evidence = str(item.get("evidence_text") or item.get("source_excerpt") or "")
        evidence_text = _resolve_evidence_text(raw_evidence, cleaned_title or title, description, source_text)
        due_date = sanitize_due_date(item.get("due_date"), source_text, request.meeting_date)

        todos.append(
            MeetingTodo(
                title=shorten(cleaned_title or strip_assignee_slot(description), 44),
                description=description or title,
                assignee_candidate=assignee_candidate,
                assignee_id=None,
                due_date=due_date,
                priority=priority,
                category=category,
                needs_leader_review=True,
                evidence_text=evidence_text,
            )
        )

    decisions = sanitize_model_statements(payload.get("decisions"), source_text, request.meeting_date)
    risks = sanitize_model_statements(payload.get("risks"), source_text, request.meeting_date)
    keywords = [str(k).strip() for k in (payload.get("keywords") or []) if str(k).strip()]
    todos = repair_ollama_todos(todos, request)

    return MeetingAnalysisResult(
        summary=summary,
        decisions=decisions,
        todos=todos,
        risks=risks,
        keywords=keywords[:8],
        meeting_meta=MeetingMeta(
            title=request.title,
            meeting_date=request.meeting_date,
            participants=resolve_participants(request),
        ),
    )


def repair_ollama_todos(todos: List[MeetingTodo], request: AnalyzeRequest) -> List[MeetingTodo]:
    source_text = request.text or request.title
    explicit_candidates = extract_explicit_task_candidates(source_text)
    if not explicit_candidates:
        return todos or build_todos(source_text, normalize_text(source_text), request.meeting_date, request.participants)

    has_placeholder = any(is_schema_placeholder(todo.title) or is_schema_placeholder(todo.description) for todo in todos)
    all_unassigned = bool(todos) and all(not todo.assignee_candidate for todo in todos)
    missing_explicit_tasks = len(todos) < len(explicit_candidates)
    if not todos or has_placeholder or all_unassigned or missing_explicit_tasks:
        logger.info("Ollama To-Do 결과를 회의록 원문 기반 담당자 추출로 보정합니다.")
        return build_todos(source_text, normalize_text(source_text), request.meeting_date, request.participants)
    return fill_missing_assignees_from_speaker_evidence(todos, explicit_candidates, request.participants)


def fill_missing_assignees_from_speaker_evidence(
    todos: List[MeetingTodo],
    speaker_candidates: List[tuple[str, str]],
    participants: List[str],
) -> List[MeetingTodo]:
    allowed_names = _allowed_assignee_names(participants)
    repaired: List[MeetingTodo] = []
    for todo in todos:
        if todo.assignee_candidate and todo.evidence_text:
            repaired.append(todo)
            continue

        evidence_tokens = _tokenize_for_overlap(f"{todo.title} {todo.description}")
        matched_speaker = ""
        matched_sentence = ""
        for speaker, sentence in speaker_candidates:
            if not todo.assignee_candidate and allowed_names is not None and speaker not in allowed_names:
                continue
            if _has_meaningful_token_overlap(evidence_tokens, _tokenize_for_overlap(sentence)):
                matched_speaker, matched_sentence = speaker, sentence
                break

        updates = {}
        if not todo.assignee_candidate and matched_speaker:
            updates["assignee_candidate"] = matched_speaker
        if not todo.evidence_text and matched_sentence:
            updates["evidence_text"] = f"{matched_speaker}: {matched_sentence}" if matched_speaker else matched_sentence
        repaired.append(todo.model_copy(update=updates) if updates else todo)
    return repaired


def is_schema_placeholder(value: str) -> bool:
    text = value.strip()
    return any(token in text for token in ["업무 제목", "간단히", "담당자 이름", "또는 빈 문자열", "..."])


def build_todos(raw_text: str, normalized_text: str, meeting_date: str, participants: Optional[List[str]] = None) -> List[MeetingTodo]:
    explicit_candidates = extract_explicit_task_candidates(raw_text)
    used_speaker_format = bool(explicit_candidates)
    is_generic_fallback = False
    if used_speaker_format:
        candidates = explicit_candidates
    else:
        sentences = extract_sentences(
            normalized_text,
            ["담당", "작성", "구현", "정리", "검토", "준비", "연결", "테스트", "제출", "설계"],
            6,
        )
        if not sentences:
            is_generic_fallback = True
            sentences = [
                "회의록 AI 분석 API 구현",
                "분석 결과 화면과 업무 보드 등록 흐름 연결",
                "팀장 검토용 To-Do 승인 화면 점검",
            ]
        candidates = [(extract_assignee_candidate(sentence), sentence) for sentence in sentences]

    try:
        base_date = date.fromisoformat(meeting_date)
    except ValueError:
        base_date = date.today()

    allowed_names = _allowed_assignee_names(participants or [])
    todos: List[MeetingTodo] = []
    for index, (assignee, sentence) in enumerate(candidates):
        display_assignee = assignee
        if allowed_names is not None and display_assignee not in allowed_names:
            display_assignee = ""
        if is_generic_fallback:
            evidence_text = ""
        elif used_speaker_format and assignee:
            evidence_text = shorten(f"{assignee}: {sentence}", _EVIDENCE_MAX_LEN)
        else:
            evidence_text = shorten(sentence, _EVIDENCE_MAX_LEN)
        todos.append(
            MeetingTodo(
                title=shorten(clean_todo_title(sentence), 44),
                description=sentence,
                assignee_candidate=display_assignee,
                due_date=sanitize_due_date(extract_due_date_candidate(sentence, base_date.year), raw_text, meeting_date),
                priority="HIGH" if index < 2 else "MEDIUM",
                category=infer_category(sentence),
                evidence_text=evidence_text,
            )
        )
    return todos


_ASSIGNEE_PATTERNS = [
    re.compile(r"^([가-힣]{2,4})(?:은|는|이|가)\s"),
    re.compile(r"담당[:\s]+([가-힣]{2,4})"),
]

# "이름: 발언" 형식의 화자 줄(회의록 전사 포맷)을 인식한다.
_SPEAKER_LINE_PATTERN = re.compile(r"^([가-힣]{2,4})\s*[:：]\s*(.+)$")
_SPEAKER_SEGMENT_PATTERN = re.compile(r"([가-힣]{2,4})\s*[:：]\s*")
_TASK_KEYWORDS = ["담당", "작성", "구현", "정리", "검토", "준비", "연결", "테스트", "제출", "설계", "맡", "잡", "만들", "보여주", "추출"]
_FORMAL_TASK_KEYWORDS = [
    "확인", "점검", "검토", "정리", "작성", "구현", "개선", "연결", "테스트",
    "표시", "반영", "처리", "준비", "설계", "추출", "관리", "삭제", "등록",
]
_FORMAL_TASK_COMMITMENT_HINTS = [
    "다음 회의 전까지", "전까지", "점검한다", "확인한다", "검토한다", "정리한다",
    "작성한다", "구현한다", "개선한다", "확인해보겠다고", "점검해보겠다고",
    "검토해보겠다고", "확인해보겠다고 말했다", "점검해보겠다고 말했다",
]
_SPEAKER_TASK_LIMIT = 12


def extract_assignee_candidate(sentence: str) -> str:
    """문장에서 "OO가/은/는 ~한다" 또는 "담당: OO" 형태로 적힌 담당자 이름을 추출한다. 없으면 빈 문자열(미배정 후보)."""
    trimmed = sentence.strip()
    for pattern in _ASSIGNEE_PATTERNS:
        match = pattern.search(trimmed)
        if match:
            return match.group(1)
    return ""


def extract_due_date_candidate(sentence: str, base_year: int) -> Optional[str]:
    match = _DATEISH_PATTERN.search(sentence)
    if not match:
        return None
    return _normalize_date_token(match.group(0), f"{base_year}-01-01")


def extract_speaker_task_candidates(text: str) -> List[tuple[str, str]]:
    """"이름: 발언" 형식의 회의록 전사에서, 화자가 직접 담당을 언급한 문장만 (화자, 문장) 쌍으로 추출한다.
    화자 줄이 전혀 없는 텍스트(전사 포맷이 아닌 경우)에는 빈 리스트를 반환해 기존 키워드 추출로 대체한다."""
    found: List[tuple[str, str]] = []
    for speaker, utterance in iter_speaker_utterances(text):
        for sentence in re.split(r"[.!?。！？]", utterance):
            s = sentence.strip()
            if len(s) < 4:
                continue
            is_commitment = "겠습니다" in s or any(keyword in s for keyword in _TASK_KEYWORDS)
            if is_commitment:
                found.append((speaker, shorten(s, 120)))
            if len(found) >= _SPEAKER_TASK_LIMIT:
                return found
    return found


def extract_formal_task_candidates(text: str) -> List[tuple[str, str]]:
    """표준 회의록 문체("김민준은 ... 확인하고, 박지수는 ... 점검한다")에서
    실제 후속 업무로 읽히는 이름+행동 절만 추출한다."""
    section = extract_followup_section(text) or text
    found = extract_named_action_clauses(section, trust_followup_section=bool(extract_followup_section(text)))
    if found:
        return found[:_SPEAKER_TASK_LIMIT]

    # 후속 일정 섹션이 없더라도 "OO는 ... 점검해보겠다고 말했다"처럼 명확한 자기 업무 발언은 보조 추출한다.
    if section != text:
        return []
    candidates: List[tuple[str, str]] = []
    for sentence in split_sentences(text):
        if not any(hint in sentence for hint in _FORMAL_TASK_COMMITMENT_HINTS):
            continue
        candidates.extend(extract_named_action_clauses(sentence))
        if len(candidates) >= _SPEAKER_TASK_LIMIT:
            break
    return candidates[:_SPEAKER_TASK_LIMIT]


def extract_explicit_task_candidates(text: str) -> List[tuple[str, str]]:
    candidates = extract_speaker_task_candidates(text)
    if candidates:
        return candidates
    return extract_formal_task_candidates(text)


def extract_followup_section(text: str) -> str:
    normalized = text.replace("\r", "\n")
    match = re.search(r"추후\s*일정\s*[:：]?\s*(.+)", normalized, flags=re.S)
    if not match:
        return ""
    section = match.group(1)
    section = re.split(r"\n\s*(작성자|특이\s*사항|안건|논의\s*내용)\s*[:：]?", section, maxsplit=1)[0]
    return section.strip()


def extract_named_action_clauses(text: str, trust_followup_section: bool = False) -> List[tuple[str, str]]:
    found: List[tuple[str, str]] = []
    pattern = re.compile(r"([가-힣]{2,4})(?:은|는|이|가)\s+")
    matches = list(pattern.finditer(text))
    for index, match in enumerate(matches):
        speaker = match.group(1)
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        clause = text[start:end].strip(" ,.\n\t")
        clause = re.split(r"[.。!?！？]\s*", clause, maxsplit=1)[0].strip(" ,.\n\t")
        if not clause:
            continue
        if not any(keyword in clause for keyword in _FORMAL_TASK_KEYWORDS):
            continue
        if not trust_followup_section and not (
            any(hint in clause for hint in _FORMAL_TASK_COMMITMENT_HINTS)
            or "전까지" in text[max(0, match.start() - 20):match.start()]
            or "추후" in text[max(0, match.start() - 20):match.start()]
        ):
            continue
        found.append((speaker, shorten(clause, 120)))
        if len(found) >= _SPEAKER_TASK_LIMIT:
            break
    return found


def iter_speaker_utterances(text: str) -> List[tuple[str, str]]:
    segments: List[tuple[str, str]] = []
    for line in text.splitlines():
        trimmed = line.strip()
        if not trimmed:
            continue
        matches = list(_SPEAKER_SEGMENT_PATTERN.finditer(trimmed))
        if len(matches) >= 2:
            for index, match in enumerate(matches):
                next_start = matches[index + 1].start() if index + 1 < len(matches) else len(trimmed)
                segments.append((match.group(1), trimmed[match.end() : next_start].strip()))
            continue
        match = _SPEAKER_LINE_PATTERN.match(trimmed)
        if match:
            segments.append((match.group(1), match.group(2)))
    return segments


def extract_sentences(text: str, keywords: List[str], limit: int) -> List[str]:
    results: List[str] = []
    for sentence in split_sentences(text):
        if len(sentence) < 6:
            continue
        if any(keyword in sentence for keyword in keywords):
            results.append(shorten(sentence, 120))
        if len(results) >= limit:
            break
    return results


def split_sentences(text: str) -> List[str]:
    normalized = text.replace("\r", "\n")
    for marker in [".", "?", "!", "。", "？", "！"]:
        normalized = normalized.replace(marker, "\n")
    return [line.strip(" -•\t") for line in normalized.split("\n") if line.strip()]


def infer_category(sentence: str) -> str:
    lower = sentence.lower()
    if "api" in lower or "spring" in lower or "백엔드" in sentence or "서버" in sentence:
        return "BACKEND"
    if "ui" in lower or "react" in lower or "화면" in sentence or "프론트" in sentence:
        return "FRONTEND"
    if "모델" in sentence or "분석" in sentence or "ai" in lower or "llm" in lower:
        return "AI"
    if "데이터" in sentence or "db" in lower or "erd" in lower:
        return "DATABASE"
    if "테스트" in sentence or "검수" in sentence:
        return "QA"
    if "발표" in sentence or "ppt" in lower:
        return "PRESENTATION"
    if "문서" in sentence or "보고서" in sentence or "제안서" in sentence:
        return "DOCUMENT"
    return "ETC"


def build_keywords(text: str, source_type: str) -> List[str]:
    keywords = ["회의록 AI", source_type]
    for candidate in ["Spring Boot", "FastAPI", "LLM", "RAG", "STT", "To-Do", "업무 보드", "대시보드", "기여도", "해커톤", "공모전", "캡스톤"]:
        if candidate in text and candidate not in keywords:
            keywords.append(candidate)
    return keywords[:8]


def normalize_text(text: str) -> str:
    return " ".join(text.split()) if text else ""


def shorten(value: str, max_len: int) -> str:
    return value if len(value) <= max_len else value[: max_len - 1] + "…"
