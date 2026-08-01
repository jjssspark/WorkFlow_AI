"""실제 pgvector PostgreSQL을 띄우는 통합 테스트용 픽스처.

RAG 검색·색인 테스트는 지금까지 전부 asyncpg 풀을 가짜 객체로 바꿔 놓고 돌았다. SQL은
문자열로만 검사됐을 뿐 한 번도 실행되지 않았으므로 다음은 검증된 적이 없다.

  - ``embedding <=> $1::vector`` — pgvector 확장과 연산자가 실제로 존재하는지
  - ``to_vector_literal``이 만드는 ``[0.10000000,...]``을 pgvector가 파싱하는지
  - ``WHERE project_id = $2``가 정말 다른 프로젝트를 걸러내는지

특히 ``db/init/01_base_schema.sql``은 ``document_chunks.embedding``을 JSONB로 만들고,
``vector(1024)``가 되는 건 손으로 동기화하는 생성물(``11_pre_baseline_backfill.sql``)을
거쳐서다. 그게 어긋나면 새로 만든 DB에서 RAG 질의가 전부 터지는데, 실제 DB에 한 번
넣어보는 것 말고는 검출할 방법이 없다.

스키마는 운영 dev compose와 같은 방식으로 만든다 - ``db/init``을
``/docker-entrypoint-initdb.d``에 마운트해 Postgres가 직접 파일명 순서대로 실행하게 한다.
따로 실행 로직을 두면 그 로직 자체가 운영 경로와 어긋날 수 있다.
"""

from __future__ import annotations

import asyncio
import time
from pathlib import Path

import asyncpg
import pytest
import pytest_asyncio
from testcontainers.core.container import DockerContainer

from core.config import get_settings


# 개발자 로컬 .env 가 프로세스 환경에 새어 들어와 테스트 결과를 바꾸는 것을 막는다.
# 아래 값들은 "어느 LLM 백엔드를 쓸지"를 고르는 스위치라, 값이 하나라도 남아 있으면
# generation_service 가 자동 폴백 체인 대신 고정 백엔드로 빠져 테스트가 패치한 경로를
# 아예 타지 않는다.
_PROVIDER_ENV_VARS = ("RAG_PROVIDER", "MEETING_ANALYSIS_PROVIDER")


@pytest.fixture(autouse=True)
def _isolate_ambient_env(monkeypatch: pytest.MonkeyPatch):
    """테스트를 개발자 로컬 환경에서 격리한다.

    app/main.py 는 임포트 시점에 load_dotenv() 를 호출한다. 그래서 FastAPI 앱을 임포트하는
    테스트가 하나라도 먼저 돌면 App/.env 의 값이 os.environ 에 영구히 주입되고, 그 뒤로
    도는 모든 테스트가 그 값을 보게 된다.

    실제로 test_assistant_router / test_chat_router_query / test_rag_internal_auth 중
    아무거나 앞에 오면 RAG_PROVIDER 가 주입돼 test_generation_service 16건이 무너졌다.
    한 줄짜리 파일(from app.main import app)만으로도 재현된다. .env 는 .gitignore 대상이라
    CI에는 없어서, 로컬에서만 빨갛고 CI에서는 초록인 - 아무도 믿지 않게 되는 - 상태였다.

    monkeypatch 로 지우므로 스스로 setenv 하는 테스트는 그대로 자기 값을 쓴다.
    설정은 lru_cache 되므로 환경을 바꾼 뒤에는 캐시도 비워야 한다.
    """
    for name in _PROVIDER_ENV_VARS:
        monkeypatch.delenv(name, raising=False)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()

# tests/llm_rag_assistant/ -> tests/ -> backend_fastapi/ -> App/
_INIT_SCRIPT_DIR = (
    Path(__file__).resolve().parents[3] / "backend_spring" / "src" / "main" / "resources" / "db" / "init"
)

# 운영(docker-compose.prod.yml)이 쓰는 이미지와 같다. 일반 postgres 이미지에는 pgvector가
# 없어 초기화 스크립트의 CREATE EXTENSION vector에서 멈춘다.
_IMAGE = "pgvector/pgvector:pg17"
_DATABASE = "workflow_it"
_USER = "workflow_it"
_PASSWORD = "workflow_it"

# 초기화 스크립트 13개가 도는 동안에는 TCP 리스너가 열리지 않는다(Postgres 엔트리포인트가
# initdb.d 실행 중에는 유닉스 소켓만 연다). 그래서 연결 성공 자체가 곧 스키마 준비 완료
# 신호이고, 로그 문자열을 기다릴 필요가 없다. 이미지 pull이 처음이면 오래 걸릴 수 있다.
_READY_TIMEOUT_SECONDS = 180
_READY_POLL_INTERVAL_SECONDS = 0.5


def _docker_available() -> bool:
    try:
        from testcontainers.core.docker_client import DockerClient

        DockerClient().client.ping()
    except Exception:
        return False
    return True


async def _wait_until_schema_is_ready(dsn: str) -> None:
    deadline = time.monotonic() + _READY_TIMEOUT_SECONDS
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            connection = await asyncpg.connect(dsn=dsn)
        except Exception as error:  # 기동 중에는 연결 거부가 정상이다.
            last_error = error
            await asyncio.sleep(_READY_POLL_INTERVAL_SECONDS)
            continue
        try:
            await connection.execute("SELECT 1 FROM document_chunks LIMIT 0")
        finally:
            await connection.close()
        return
    raise TimeoutError(f"{_READY_TIMEOUT_SECONDS}초 안에 DB가 준비되지 않았습니다: {last_error}")


@pytest.fixture(scope="session")
def pgvector_dsn():
    """운영 초기화 스크립트가 적용된 pgvector 컨테이너를 세션당 한 번 띄운다."""
    if not _INIT_SCRIPT_DIR.is_dir():
        pytest.fail(f"초기화 스크립트 디렉터리를 찾지 못했습니다: {_INIT_SCRIPT_DIR}")
    if not _docker_available():
        pytest.skip("Docker를 사용할 수 없어 실제 DB 통합 테스트를 건너뜁니다.")

    container = (
        DockerContainer(_IMAGE)
        .with_env("POSTGRES_DB", _DATABASE)
        .with_env("POSTGRES_USER", _USER)
        .with_env("POSTGRES_PASSWORD", _PASSWORD)
        .with_volume_mapping(str(_INIT_SCRIPT_DIR), "/docker-entrypoint-initdb.d", "ro")
        .with_exposed_ports(5432)
    )
    container.start()
    try:
        dsn = (
            f"postgresql://{_USER}:{_PASSWORD}"
            f"@{container.get_container_host_ip()}:{container.get_exposed_port(5432)}/{_DATABASE}"
        )
        asyncio.run(_wait_until_schema_is_ready(dsn))
        yield dsn
    finally:
        container.stop()


@pytest_asyncio.fixture
async def pgvector_pool(pgvector_dsn: str):
    """테스트 함수마다 새 풀을 만든다.

    풀을 세션 스코프로 두면 픽스처를 만든 이벤트 루프와 테스트가 도는 루프가 달라져
    asyncpg가 깨진다. 풀 생성은 밀리초 단위라 매번 만들어도 부담이 없다.

    컨테이너는 세션 내내 공유되므로 앞 테스트가 남긴 청크가 검색에 섞이지 않도록
    매번 비운다. projects는 각 테스트가 자기 것을 만들고 지운다.
    """
    pool = await asyncpg.create_pool(dsn=pgvector_dsn, min_size=1, max_size=2, statement_cache_size=0)
    try:
        async with pool.acquire() as connection:
            await connection.execute("TRUNCATE document_chunks RESTART IDENTITY")
        yield pool
    finally:
        await pool.close()
