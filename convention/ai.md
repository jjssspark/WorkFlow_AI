# AI Backend 개발 컨벤션 (WorkFlow AI · FastAPI)

FastAPI 0.139 + Python 3.12 기반 AI 서버. LLM(회의록 분석·RAG·기여도 요약), ML/DL(지연 위험도·업무 편중·문장 분류), 임베딩 추론을 담당한다. Spring Boot가 `/ai/*` 엔드포인트를 호출한다.

## 기술 스택 (고정 버전)

| 영역 | 기술 | 버전 |
| --- | --- | --- |
| 런타임 | Python | 3.12.13 (`.python-version`) |
| 웹 | FastAPI / Uvicorn | 0.139 / 0.51 |
| 검증 | Pydantic v2 (+ pydantic-settings) | 2.13 / 2.14 |
| ML | scikit-learn / XGBoost / LightGBM / NumPy | 1.6 / 3.2 / 4.6 / 2.5 |
| DL | PyTorch(CPU, 선택 설치) / Transformers | 2.13 / 4.48 |
| STT | faster-whisper | 1.2 (FFmpeg OS 바이너리 별도 필요) |
| LLM | OpenAI SDK 1.x / Ollama(gemma) | 1.59 / 0.6 |
| LLM(LangChain) | langchain-core / langchain-huggingface / langsmith | 1.4 / 1.2 / 0.10.2 |
| Vector | pgvector (PostgreSQL 17) | 0.8 |
| 파일 | pdfplumber / python-docx | 0.11 / 1.1 |

설치·실행: `py -3.12 -m venv .venv && .venv/Scripts/pip install -r requirements.txt` (저장소 루트의 `requirements.txt` 사용)

- PyTorch는 용량 문제로 기본 설치 제외 — 필요 시 `pip install torch==2.13.0 --index-url https://download.pytorch.org/whl/cpu`
- LangChain은 RAG 챗봇 라우터(langchain-core/langchain-huggingface)와 워크로드/기여도 스코어
  파이프라인(`ml_workload_score`, `contribution_score` - langchain-core `@chain`)에 적용됨.
  LangSmith로 트레이싱.

## 폴더 구조 (모델·기능별 분리)

기존 구조를 따른다.

```
backend_fastapi/
├── app/                          # 진입점·라우터 조합
├── core/                         # 설정, DB/vector 연결, queue
│   └── queue/                    # 비동기 처리
├── llm_rag_assistant/            # LLM/RAG (FS-4)
│   └── app/
└── dl_sentence_classification/   # DL 문장 분류 (P1)
    └── app/
```

새 모델/기능(ML 점수, 회의록 분석 등)은 최상위에 기능 폴더를 만들고 그 안에 `app/`(라우터·서비스)을 둔다. 공유 설정·연결은 `core/`.

## 네이밍

- 모듈/파일/함수/변수: `snake_case`
- 클래스(Pydantic 모델 포함): `PascalCase`
- 상수: `UPPER_SNAKE_CASE`
- 라우터 경로: `/ai/{도메인}/{동작}` (`/ai/meeting/analyze`, `/ai/predict/delay`, `/ai/score/workload`, `/ai/rag/query`, `/ai/contribution/summarize`, `/ai/ml/anomaly`)

## API / 스키마 규칙

- 모든 요청·응답은 **Pydantic v2 모델**로 정의(`XxxRequest`/`XxxResponse`). 입력은 경계에서 검증.
- LLM 출력은 반드시 **구조화 스키마로 고정**(JSON). 자유 텍스트 그대로 반환 금지.
  - 회의록 분석: `summary / decisions / risks / action_items` 필드 강제
  - Function Calling 또는 JSON 모드로 구조화 출력 유도 후 Pydantic 검증.
- RAG 답변은 **출처(source) 필드 필수**(AC-06) — 근거 chunk 메타데이터 포함.
- 실패·타임아웃 시 명시적 에러 응답(500 삼키기 금지), 표준 envelope 유지.

## LLM / RAG 파이프라인

1. 프로젝트 데이터 수집·요약(회의록·업무·마일스톤 압축)
2. 유형별 프롬프트 템플릿에 컨텍스트 주입
3. LLM 호출(OpenAI 또는 Ollama gemma)
4. 스키마 검증 후 반환

- 프롬프트는 코드에 하드코딩하지 말고 템플릿으로 분리·버전 관리.
- 임베딩은 pgvector에 저장, 검색은 프로젝트 범위로 필터링(권한 격리).
- LLM 프로바이더는 설정으로 교체 가능하게(OpenAI ↔ Ollama).

## ML / DL 규칙

- 학습·실험은 노트북(`ipynb`)으로 진행하고 진행 상황 그래프를 남긴다. 넘버링 `01`, 하위는 `01-1`.
- 산출물(그래프·모델·리포트)은 `output/` 폴더에 저장(없으면 생성). 실험 결과 md는 `document_{이름}/`에 정리.
- baseline 우선 → 이후 하이퍼파라미터 튜닝. 재현 위해 random seed 고정.
- 추론 서빙 코드와 학습 코드 분리. 서빙은 모델 로드 후 순수 추론만.
- ML 예측 결과는 Spring의 `ml_predictions` 테이블 스키마(`model_type`, `result`, `score`)에 맞춰 반환. 이상치 탐지는 `model_type='isolation_forest'`.

## 보안 / 설정

- API 키·DB 접속정보는 `pydantic-settings`로 **환경변수** 로드. 하드코딩·커밋 금지.
- 시작 시 필수 시크릿 존재 여부 검증(fail-fast).
- 업로드 파일은 타입·크기 검증 후 처리. 신뢰 못 하는 입력으로 취급.
- `.venv/`, 모델 가중치, `__pycache__`는 커밋 제외.

## 코드 원칙

- 함수 50줄, 파일 800줄 이내. 깊은 중첩 금지 — early return.
- 타입 힌트 필수, Pydantic으로 경계 검증.
- 에러는 명시적 핸들링, 삼키지 말 것.
- 요청 범위를 벗어난 추상화 금지(YAGNI).

## 커밋 전 체크

- [ ] `pip check` 충돌 없음
- [ ] 하드코딩된 API 키/시크릿 없음
- [ ] LLM 출력 스키마 검증 포함
- [ ] 대용량 파일(.venv/모델/데이터) 커밋 제외
- [ ] 실험 산출물은 `output/`, 문서는 `document_{이름}/`에 정리
