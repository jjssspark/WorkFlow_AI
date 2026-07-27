from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, field_validator


class RagIngestRequest(BaseModel):
    project_id: int
    source_type: Literal["meeting", "task", "action_item"]
    source_id: int
    content: str
    assignee_id: int | None = None

    @field_validator("content")
    @classmethod
    def content_must_not_be_blank(cls, value: str) -> str:
        # 인덱싱은 "기존 청크 삭제 후 재삽입"으로 구현돼 있다. 빈 콘텐츠를 그대로 통과시키면
        # 삭제만 실행돼 해당 문서가 RAG에서 조용히 사라진다. 삭제가 목적이라면 호출자는
        # /delete-source를 써야 하므로, 빈 값은 성공으로 처리하지 않고 거부한다.
        if not value.strip():
            raise ValueError("content는 비어 있을 수 없습니다. 삭제는 /delete-source를 사용하세요.")
        return value


class RagIngestResponse(BaseModel):
    chunk_ids: list[int]
    chunk_count: int


class RagAssigneeSyncRequest(BaseModel):
    project_id: int
    source_type: Literal["task", "action_item"]
    source_id: int
    assignee_id: int | None = None


class RagHistoryMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class RagQueryRequest(BaseModel):
    project_id: int
    question: str
    user_id: int | None = None
    # 클라이언트가 보내는 직전 대화 기록. 후속 질문 재작성에만 쓰며, 서버는 이 대화의
    # 진위를 검증하지 않는다(권한값은 여기서 유도하지 않음). 기본값 빈 리스트로 기존 클라이언트 호환.
    history: list[RagHistoryMessage] = []


class RagSource(BaseModel):
    source_type: Literal["meeting", "task", "action_item"]
    source_id: int
    content_snippet: str
    similarity: float


class RagQueryResponse(BaseModel):
    answer: str
    sources: list[RagSource]
