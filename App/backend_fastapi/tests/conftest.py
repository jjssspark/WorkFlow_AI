"""테스트 전체에 적용되는 격리.

이 파일이 tests/llm_rag_assistant/conftest.py 가 아니라 여기 있는 이유: 아래 오염은
app.main 을 임포트하는 모든 테스트에 걸린다. 처음에는 RAG 쪽에서만 발견돼 그 폴더에만
픽스처를 뒀는데, 그 사이 tests/test_meeting_analysis.py 가 같은 이유로 깨져 있었다
(2026-08-02 확인). 격리는 오염원과 같은 층에 둬야 한다.
"""

from __future__ import annotations

import pytest

from core.config import get_settings

# 개발자 로컬 .env 가 프로세스 환경에 새어 들어와 테스트 결과를 바꾸는 것을 막는다.
# 아래 값들은 "어느 LLM 백엔드를 쓸지"를 고르는 스위치라, 값이 하나라도 남아 있으면
# 자동 폴백 체인 대신 고정 백엔드로 빠져 테스트가 패치한 경로를 아예 타지 않는다.
_PROVIDER_ENV_VARS = ("RAG_PROVIDER", "MEETING_ANALYSIS_PROVIDER")


@pytest.fixture(autouse=True)
def _isolate_ambient_env(monkeypatch: pytest.MonkeyPatch):
    """테스트를 개발자 로컬 환경에서 격리한다.

    app/main.py 는 임포트 시점에 load_dotenv() 를 호출한다. 그래서 FastAPI 앱을 임포트하는
    테스트가 하나라도 먼저 돌면 App/.env 의 값이 os.environ 에 영구히 주입되고, 그 뒤로
    도는 모든 테스트가 그 값을 보게 된다.

    실측으로 두 번 확인됐다.
      - RAG_PROVIDER 주입 -> test_generation_service 16건 실패 (2026-08-01)
      - MEETING_ANALYSIS_PROVIDER=huggingface 주입 -> ollama 폴백 테스트가 폴백에 도달조차
        못 해 실패 (2026-08-02). 이건 단독 실행에서도 재현된다 - 그 파일 자신이 app.main 을
        임포트하기 때문이다.

    .env 는 .gitignore 대상이라 CI에는 없어서, 로컬에서만 빨갛고 CI에서는 초록인 -
    아무도 스위트를 믿지 않게 되는 - 상태였다.

    monkeypatch 로 지우므로 스스로 setenv 하는 테스트는 그대로 자기 값을 쓴다.
    설정은 lru_cache 되므로 환경을 바꾼 뒤에는 캐시도 비워야 한다.
    """
    for name in _PROVIDER_ENV_VARS:
        monkeypatch.delenv(name, raising=False)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()
