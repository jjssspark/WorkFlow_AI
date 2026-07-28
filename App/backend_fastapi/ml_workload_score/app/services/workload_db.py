"""
DB 연결 모듈 - Supabase PostgreSQL

주의: 비밀번호/연결정보는 절대 코드에 하드코딩하지 않는다.
프로젝트 루트에 `.env` 파일을 만들고 아래처럼 넣을 것 (.env는 .gitignore에 반드시 포함):

    DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.zzfcnbbzmbxzxptxghhq.supabase.co:5432/postgres

Supabase 대시보드 > Project Settings > Database > Connection string 에서 복사해서
[YOUR-PASSWORD] 부분만 실제 비밀번호로 바꿔 넣으면 됨.
"""

import os
import pandas as pd
from sqlalchemy import create_engine, text
from dotenv import dotenv_values

from core.database_url import normalize_database_url

# os.environ을 직접 변경하면 다른 모듈(core.config.Settings 등)의 환경변수까지
# 전역으로 오염시키므로, .env는 별도 딕셔너리로만 읽는다.
_env = {**dotenv_values(), **os.environ}

DATABASE_URL = normalize_database_url(
    _env.get("DATABASE_URL") or "",
    use_transaction_pooler=str(_env.get("DATABASE_USE_TRANSACTION_POOLER", "")).lower()
    in {"1", "true", "yes", "on"},
)


def get_engine():
    if not DATABASE_URL:
        raise RuntimeError(
            "DATABASE_URL 환경변수가 없습니다. 프로젝트 루트에 .env 파일을 만들고 "
            "DATABASE_URL=postgresql://... 형식으로 넣어주세요."
        )
    # Supabase Session pooler는 무료 티어 기준 동시 세션이 15개로 제한된다.
    # 매 호출마다 새 엔진을 만들므로 풀을 크게 잡으면 다른 서비스(Spring Boot 등)와
    # 세션 한도를 다투게 되어 pool_size=1로 최소화한다. 사용 후 dispose()로 즉시 반납할 것.
    return create_engine(DATABASE_URL, pool_pre_ping=True, pool_size=1, max_overflow=0)


def load_tasks_from_db(project_id: int) -> pd.DataFrame:
    """
    실제 tasks 테이블에서 특정 프로젝트의 업무를 읽어온다.
    반환 컬럼은 workload_score.build_features()가 기대하는 것과 동일하게 맞춤:
    task_id, project_id, assignee_id, category, priority, status, due_date
    """
    engine = get_engine()
    query = text("""
        SELECT
            id AS task_id,
            project_id,
            assignee_id,
            category,
            priority,
            status,
            due_date
        FROM public.tasks
        WHERE project_id = :project_id
          AND assignee_id IS NOT NULL
    """)
    try:
        with engine.connect() as conn:
            df = pd.read_sql(query, conn, params={"project_id": project_id})
    finally:
        engine.dispose()

    # due_date를 pandas Timestamp로 통일 (NULL 허용이므로 NaT 처리)
    df["due_date"] = pd.to_datetime(df["due_date"])
    # assignee_id는 실제로는 bigint(유저 id)라 문자열로 바꿔서 기존 코드(assignee_1 형태 가정)와 호환되게
    df["assignee_id"] = df["assignee_id"].astype(str)
    return df


if __name__ == "__main__":
    # 연결 테스트용 (DATABASE_URL 없으면 여기서 바로 에러 메시지 확인 가능)
    try:
        df = load_tasks_from_db(project_id=1)
        print(f"tasks 조회 성공: {len(df)}건")
        print(df.head())
    except Exception as e:
        print(f"DB 연결 실패 (정상 - 아직 .env 안 만들었으면 이 메시지가 뜸): {e}")
