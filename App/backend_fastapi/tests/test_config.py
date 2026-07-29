from __future__ import annotations

import pytest
from pydantic import ValidationError

from core.config import Settings


def test_settings_requires_database_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)

    with pytest.raises(ValidationError):
        Settings(_env_file=None)


def test_settings_loads_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pw@localhost:5432/workflow")

    settings = Settings(_env_file=None)
    assert settings.database_url == "postgresql://user:pw@localhost:5432/workflow"
    assert settings.embedding_model == "nomic-embed-text"
    assert settings.generation_model == "gemma4:e2b"


def test_settings_normalizes_database_url_and_transaction_pooler(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(
        "DATABASE_URL",
        "postgresql://user:pa/ss%word@aws-1-region.pooler.supabase.com:5432/postgres",
    )
    monkeypatch.setenv("DATABASE_USE_TRANSACTION_POOLER", "true")

    settings = Settings(_env_file=None)

    assert settings.database_url == (
        "postgresql://user:pa%2Fss%25word@aws-1-region.pooler.supabase.com:6543/postgres"
    )


def test_settings_defaults_redis_connection(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pw@localhost:5432/workflow")
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.delenv("REDIS_USERNAME", raising=False)
    monkeypatch.delenv("REDIS_PASSWORD", raising=False)

    settings = Settings(_env_file=None)

    assert settings.redis_url == "redis://localhost:6379/0"
    assert settings.redis_username is None
    assert settings.redis_password is None


def test_settings_loads_redis_connection_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pw@localhost:5432/workflow")
    monkeypatch.setenv("REDIS_URL", "redis://redis.internal:6380/2")
    monkeypatch.setenv("REDIS_USERNAME", "queue-user")
    monkeypatch.setenv("REDIS_PASSWORD", "test-password")

    settings = Settings(_env_file=None)

    assert settings.redis_url == "redis://redis.internal:6380/2"
    assert settings.redis_username == "queue-user"
    assert settings.redis_password == "test-password"


def test_settings_defaults_hf_embedding_model(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pw@localhost:5432/workflow")
    monkeypatch.delenv("HF_EMBEDDING_MODEL", raising=False)

    settings = Settings(_env_file=None)

    assert settings.hf_embedding_model == "rhantj/bge-m3-workflow-query-robust"


def test_settings_defaults_hf_embedding_model_revision(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pw@localhost:5432/workflow")
    monkeypatch.delenv("HF_EMBEDDING_MODEL_REVISION", raising=False)

    settings = Settings(_env_file=None)

    assert settings.hf_embedding_model_revision == "dc328732ab2c3330d38305199e26b2d060586af3"


def test_settings_defaults_hf_rag_generation_model(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pw@localhost:5432/workflow")
    monkeypatch.delenv("HF_MEETING_ANALYSIS_MODEL", raising=False)

    settings = Settings(_env_file=None)

    assert settings.hf_rag_generation_model == "Qwen/Qwen3-4B-Instruct-2507"


def test_settings_reads_hf_rag_generation_model_from_meeting_analysis_env_var(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pw@localhost:5432/workflow")
    monkeypatch.setenv("HF_MEETING_ANALYSIS_MODEL", "some-org/some-model")

    settings = Settings(_env_file=None)

    assert settings.hf_rag_generation_model == "some-org/some-model"


def test_settings_reads_hf_token_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pw@localhost:5432/workflow")
    monkeypatch.setenv("HF_TOKEN", "hf_abc123")

    settings = Settings(_env_file=None)

    assert settings.hf_token == "hf_abc123"
