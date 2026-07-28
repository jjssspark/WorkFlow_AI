from __future__ import annotations

import hmac

from fastapi import Depends, Header, HTTPException

from core.config import Settings, get_settings


async def verify_internal_api_key(
    x_internal_api_key: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> None:
    """Spring만 내부 AI 엔드포인트를 호출할 수 있도록 서비스 간 공유 시크릿을 검증한다.

    docker-compose가 FastAPI 포트(8000)를 호스트에 노출하므로, 이 검증이 없으면 Spring을
    거치지 않고 직접 호출해 project_id/user_id를 임의로 지정할 수 있다(사칭·메타데이터 변조).
    시크릿이 설정되지 않은 경우도 보호가 조용히 꺼지지 않도록 거부한다(fail-closed).
    """
    expected = settings.rag_internal_api_key
    if not expected or not x_internal_api_key or not hmac.compare_digest(x_internal_api_key, expected):
        raise HTTPException(status_code=401, detail={"error": "unauthorized"})
