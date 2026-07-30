from __future__ import annotations

import os
from unittest.mock import patch

import pytest

from core.tracing import setup_langsmith

# setup_langsmith()은 os.environ에 직접 값을 쓴다. monkeypatch.setenv/delenv는 "테스트 시작
# 시점에 이미 존재하던 값"만 복원 대상으로 추적하므로, 테스트 도중 함수가 새로 만들어낸
# LANGSMITH_* 키(예: 이전 테스트에서 만든 LANGSMITH_PROJECT)는 다음 테스트로 새어나갈 수 있다.
# 각 테스트 전후로 관련 환경변수를 강제로 정리해 테스트 간 격리를 보장한다.
_LANGSMITH_ENV_VARS = ("LANGSMITH_API_KEY", "LANGSMITH_TRACING", "LANGSMITH_PROJECT")


@pytest.fixture(autouse=True)
def _clean_langsmith_env():
    for var in _LANGSMITH_ENV_VARS:
        os.environ.pop(var, None)
    yield
    for var in _LANGSMITH_ENV_VARS:
        os.environ.pop(var, None)


def test_setup_langsmith_returns_false_without_api_key(monkeypatch):
    monkeypatch.delenv("LANGSMITH_API_KEY", raising=False)
    monkeypatch.delenv("LANGSMITH_TRACING", raising=False)
    monkeypatch.delenv("LANGSMITH_PROJECT", raising=False)

    with patch("core.tracing.dotenv_values", return_value={}):
        result = setup_langsmith()

    assert result is False
    assert "LANGSMITH_TRACING" not in os.environ


def test_setup_langsmith_clears_preexisting_tracing_flag_without_api_key(monkeypatch):
    """docker-compose가 LANGSMITH_TRACING=${LANGSMITH_TRACING:-false}로 프로세스에
    이미 "true"를 주입해 놓은 상태에서 API 키만 빠지면, 반환값(False)과 실제
    환경변수 상태가 어긋나지 않도록 LANGSMITH_TRACING을 지워야 한다."""
    monkeypatch.delenv("LANGSMITH_API_KEY", raising=False)
    monkeypatch.setenv("LANGSMITH_TRACING", "true")
    monkeypatch.delenv("LANGSMITH_PROJECT", raising=False)

    with patch("core.tracing.dotenv_values", return_value={}):
        result = setup_langsmith()

    assert result is False
    assert "LANGSMITH_TRACING" not in os.environ


def test_setup_langsmith_enables_tracing_with_default_project(monkeypatch):
    monkeypatch.setenv("LANGSMITH_API_KEY", "test-key")
    monkeypatch.delenv("LANGSMITH_TRACING", raising=False)
    monkeypatch.delenv("LANGSMITH_PROJECT", raising=False)

    with patch("core.tracing.dotenv_values", return_value={}):
        result = setup_langsmith()

    assert result is True
    assert os.environ["LANGSMITH_TRACING"] == "true"
    assert os.environ["LANGSMITH_PROJECT"] == "workflow-ai-backend"


def test_setup_langsmith_respects_custom_project_name(monkeypatch):
    monkeypatch.setenv("LANGSMITH_API_KEY", "test-key")
    monkeypatch.delenv("LANGSMITH_TRACING", raising=False)
    monkeypatch.delenv("LANGSMITH_PROJECT", raising=False)

    with patch("core.tracing.dotenv_values", return_value={}):
        result = setup_langsmith(project_name="custom-project")

    assert result is True
    assert os.environ["LANGSMITH_PROJECT"] == "custom-project"


def test_setup_langsmith_reads_project_name_from_env_over_default(monkeypatch):
    monkeypatch.setenv("LANGSMITH_API_KEY", "test-key")
    monkeypatch.delenv("LANGSMITH_TRACING", raising=False)

    with patch(
        "core.tracing.dotenv_values",
        return_value={"LANGSMITH_PROJECT": "from-dotenv-project"},
    ):
        result = setup_langsmith()

    assert result is True
    assert os.environ["LANGSMITH_PROJECT"] == "from-dotenv-project"
