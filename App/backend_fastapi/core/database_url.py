from __future__ import annotations

from urllib.parse import quote, unquote


def normalize_database_url(
    raw_url: str,
    *,
    use_transaction_pooler: bool = False,
) -> str:
    """PostgreSQL URI의 사용자 정보를 안전하게 인코딩하고 필요하면 Supabase 풀 모드를 바꾼다.

    Supabase가 발급한 비밀번호에는 ``/``나 ``%`` 같은 URI 예약문자가 포함될 수 있다.
    이를 원문 그대로 DATABASE_URL에 넣으면 asyncpg/SQLAlchemy가 비밀번호 일부를 host/port로
    해석한다. 이미 인코딩된 값은 unquote 후 다시 quote해 한 번만 인코딩되도록 정규화한다.

    FastAPI는 prepared statement 캐시를 끄고 짧은 트랜잭션만 사용하므로, 제한이 작은
    Supabase Session Pooler(5432) 대신 Transaction Pooler(6543)를 사용할 수 있다.
    로컬 PostgreSQL이나 다른 호스트의 포트는 변경하지 않는다.
    """
    if not raw_url or "://" not in raw_url:
        return raw_url

    scheme, remainder = raw_url.split("://", 1)
    if scheme not in {"postgres", "postgresql"} or "@" not in remainder:
        return raw_url

    userinfo, server_and_path = remainder.rsplit("@", 1)
    if ":" not in userinfo:
        return raw_url

    username, password = userinfo.split(":", 1)
    normalized_userinfo = (
        f"{quote(unquote(username), safe='')}:{quote(unquote(password), safe='')}"
    )

    if use_transaction_pooler:
        authority, separator, path = server_and_path.partition("/")
        host, port_separator, port = authority.rpartition(":")
        if (
            port_separator
            and port == "5432"
            and host.lower().endswith(".pooler.supabase.com")
        ):
            authority = f"{host}:6543"
            server_and_path = authority + (f"/{path}" if separator else "")

    return f"{scheme}://{normalized_userinfo}@{server_and_path}"
