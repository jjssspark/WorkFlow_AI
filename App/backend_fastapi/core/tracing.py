from __future__ import annotations

import logging
import os

from dotenv import dotenv_values

logger = logging.getLogger(__name__)


def setup_langsmith(project_name: str = "workflow-ai-backend") -> bool:
    """
    LangSmith 트레이싱 활성화.

    workload_db.py와 동일한 패턴으로 dotenv_values()를 직접 읽는다 - core.config.get_settings()는
    이 dev 환경에서 App/.env를 못 찾아 ValidationError가 나는 게 확인된 상태라 재사용하지 않는다.
    ml_workload_score/contribution_score 양쪽 라우터가 공통으로 쓰므로 core/에 둔다.

    필요 환경변수:
      LANGSMITH_API_KEY - LangSmith API 키 (smith.langchain.com에서 발급)
      LANGSMITH_PROJECT - 대시보드에 표시될 프로젝트명 (선택, 없으면 project_name 사용)

    LangChain의 자동 트레이싱(Runnable.invoke/ainvoke 실행 시 콜백)도 langsmith SDK와 동일하게
    LANGSMITH_TRACING/LANGSMITH_API_KEY 환경변수를 읽으므로, 이 유틸 하나로 LangChain 파이프라인
    계측까지 함께 켜진다.
    """
    env = {**dotenv_values(), **os.environ}
    api_key = env.get("LANGSMITH_API_KEY")

    if not api_key:
        # docker-compose가 LANGSMITH_TRACING=${LANGSMITH_TRACING:-false}로 프로세스에
        # 이미 "true"를 주입해 놓은 상태에서 API 키만 빠진 경우, 여기서 지워주지 않으면
        # 반환값(False)과 실제 프로세스 상태(LANGSMITH_TRACING=true)가 어긋나 LangChain/langsmith
        # SDK가 트레이싱을 시도하다 인증 실패로 조용히 실패하는 혼선이 생길 수 있다.
        os.environ.pop("LANGSMITH_TRACING", None)
        logger.warning("LANGSMITH_API_KEY 미설정 - LangChain 트레이싱 비활성화 상태로 진행")
        return False

    os.environ["LANGSMITH_API_KEY"] = api_key
    os.environ["LANGSMITH_TRACING"] = "true"
    os.environ["LANGSMITH_PROJECT"] = env.get("LANGSMITH_PROJECT", project_name)
    logger.info("LangSmith 트레이싱 활성화됨 (project=%s)", os.environ["LANGSMITH_PROJECT"])
    return True
