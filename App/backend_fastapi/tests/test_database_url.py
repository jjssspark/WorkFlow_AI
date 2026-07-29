from core.database_url import normalize_database_url


def test_encodes_reserved_password_characters() -> None:
    raw = "postgresql://user:pa/ss%word@db.example.com:5432/workflow"

    normalized = normalize_database_url(raw)

    assert normalized == (
        "postgresql://user:pa%2Fss%25word@db.example.com:5432/workflow"
    )


def test_keeps_an_already_encoded_password_stable() -> None:
    encoded = "postgresql://user:pa%2Fss%25word@db.example.com:5432/workflow"

    assert normalize_database_url(encoded) == encoded


def test_switches_only_supabase_session_pooler_to_transaction_port() -> None:
    supabase = "postgresql://user:pw@aws-1-region.pooler.supabase.com:5432/postgres"
    local = "postgresql://user:pw@localhost:5432/workflow"

    assert normalize_database_url(supabase, use_transaction_pooler=True) == (
        "postgresql://user:pw@aws-1-region.pooler.supabase.com:6543/postgres"
    )
    assert normalize_database_url(local, use_transaction_pooler=True) == local


def test_leaves_non_postgres_and_incomplete_urls_unchanged() -> None:
    assert normalize_database_url("sqlite:///tmp/test.db") == "sqlite:///tmp/test.db"
    assert normalize_database_url("postgresql://db.example.com/workflow") == (
        "postgresql://db.example.com/workflow"
    )
