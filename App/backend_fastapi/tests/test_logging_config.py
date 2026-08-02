"""앱 로거의 INFO 가 실제로 밖으로 나가는지 확인한다.

## 왜 이 테스트가 필요한가

기동 명령은 `uvicorn app.main:app` 하나뿐이다(docker-entrypoint.sh). uvicorn 은 자기
dictConfig 로 `uvicorn*` 로거만 잡고 루트에는 핸들러를 달지 않는다. 그래서 앱 로거의
INFO 는 핸들러 없는 루트로 전파돼 `logging.lastResort` 가 WARNING 이상만 내보낸다.

이 상태에서는 **INFO 관측을 무엇을 넣어도 사라진다.** 실제로 질의 라우팅 때 넣은
"코드 라우팅 발동" 로그가 운영에서 한 번도 찍히지 않았다(2026-08-01 확인, 운영 로그 0건).
관측 수단을 만들었다고 믿고 있었는데 없었다.

## 왜 별도 프로세스인가

pytest 의 로깅 플러그인이 루트 로거에 자기 핸들러를 붙인다. `logging.basicConfig` 는
루트에 핸들러가 있으면 아무것도 하지 않으므로, **같은 프로세스 안에서는 설정이 깨져
있어도 통과한다.** caplog 로 검증해도 마찬가지다 - pytest 가 붙인 핸들러가 잡아주기
때문에 운영에서 사라지는 것을 못 잡는다.

그래서 운영 순서를 그대로 재현하는 자식 프로세스를 띄운다: uvicorn 이 먼저 자기 설정을
적용하고, 그 뒤에 앱이 임포트된다.

app.main 임포트가 무거워 이 파일 한 건에 수 초가 걸린다. 그만한 값어치가 있다고 본다 -
이 방어선이 없는 동안 관측이 통째로 사라져 있었고 아무도 몰랐다.
"""

from __future__ import annotations

import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

_BACKEND_ROOT = Path(__file__).resolve().parents[1]

# 운영 기동 순서 그대로: uvicorn 이 로깅을 세운 뒤 앱을 임포트한다.
_PROBE = textwrap.dedent(
    """
    import logging
    import logging.config

    import uvicorn.config

    logging.config.dictConfig(uvicorn.config.LOGGING_CONFIG)

    import app.main  # noqa: F401  임포트 시점에 로깅을 세우는 것이 검증 대상이다

    logging.getLogger("llm_rag_assistant.app.services.retrieval_service").info(
        "PROBE_INFO_VISIBLE"
    )
    logging.getLogger("llm_rag_assistant.app.services.retrieval_service").warning(
        "PROBE_WARNING_VISIBLE"
    )
    """
)


@pytest.fixture(scope="module")
def _probe_output() -> str:
    result = subprocess.run(
        [sys.executable, "-c", _PROBE],
        capture_output=True,
        text=True,
        cwd=_BACKEND_ROOT,
        timeout=300,
    )
    assert result.returncode == 0, f"프로브가 실패했습니다:\n{result.stderr}"
    return result.stdout + result.stderr


def test_app_logger_info_is_visible_under_the_production_startup_sequence(_probe_output: str) -> None:
    """이게 깨지면 INFO 관측이 통째로 사라진 것이다. 값만 고쳐 통과시키지 말 것.

    고치는 곳은 app/main.py 의 logging.basicConfig 다.
    """
    assert "PROBE_INFO_VISIBLE" in _probe_output, (
        "앱 로거의 INFO 가 어디에도 나가지 않습니다. app/main.py 의 로깅 설정을 확인하세요.\n"
        f"실제 출력:\n{_probe_output}"
    )


def test_app_logger_warning_is_visible_too(_probe_output: str) -> None:
    """WARNING 은 설정이 깨져 있어도 lastResort 로 우연히 나온다.

    즉 WARNING 만 보고 "로깅은 되고 있다"고 판단하면 안 된다. 이 테스트는 그 우연에
    기대지 않고 설정된 경로로도 WARNING 이 나오는지 함께 확인한다.
    """
    assert "PROBE_WARNING_VISIBLE" in _probe_output


def test_log_level_is_overridable_by_env() -> None:
    """운영에서 시끄러우면 배포를 고치지 않고 LOG_LEVEL 로 낮출 수 있어야 한다."""
    probe = _PROBE.replace("PROBE_INFO_VISIBLE", "SHOULD_NOT_APPEAR")
    result = subprocess.run(
        [sys.executable, "-c", probe],
        capture_output=True,
        text=True,
        cwd=_BACKEND_ROOT,
        timeout=300,
        env={**_clean_env(), "LOG_LEVEL": "WARNING"},
    )

    assert result.returncode == 0, result.stderr
    output = result.stdout + result.stderr
    assert "SHOULD_NOT_APPEAR" not in output
    # WARNING 은 여전히 나와야 한다 - 레벨만 올라간 것이지 로깅이 죽은 게 아니다.
    assert "PROBE_WARNING_VISIBLE" in output


def _clean_env() -> dict[str, str]:
    import os

    return {k: v for k, v in os.environ.items() if k != "LOG_LEVEL"}
