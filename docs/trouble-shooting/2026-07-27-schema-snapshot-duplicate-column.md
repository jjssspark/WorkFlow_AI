# 스키마 스냅샷 DDL이 컬럼 중복 선언으로 절반이 생성되지 않던 문제

- 날짜: 2026-07-27
- 발견 경로: `docs/db/workflow_ai_schema.sql` 커밋 전 검토 (운영 영향 없음)
- 대상: 문서용 스냅샷 DDL 1개 파일. 운영 스키마·마이그레이션은 무관
- 관련: [스키마 변경 경로 일원화 결정](../decisions/2026-07-26-flyway-single-migration-path.md)

## 증상

없었다. 그게 이 건의 핵심이다.

`docs/db/workflow_ai_schema.sql`을 2026-07-22 기준에서 07-26 기준으로 갱신한 변경이
커밋 대기 상태였다. diff만 보면 전부 정상이었다 — 신규 컬럼 추가, 컬럼 이름 변경,
테이블 2개 추가, 주석 보강. 눈으로 읽어서는 문제를 찾을 수 없다.

이 파일은 Flyway가 읽지 않고 애플리케이션도 참조하지 않는다. 그래서 **깨져 있어도
CI도 배포도 아무것도 알려주지 않는다.** 누군가 신규 환경을 세팅하려고 이 DDL을
실행하는 순간에야 드러난다.

## 원인 — 이미 선언된 컬럼을 말미에 한 번 더 추가했다

`milestones.start_date`와 `tasks.done_date`는 이전 스냅샷에도 이미 있었다.
이번 갱신이 그 사실을 놓치고 테이블 정의 끝에 같은 컬럼을 다시 선언했다.

```sql
CREATE TABLE milestones (
    ...
    start_date DATE,          -- 기존 선언
    due_date   DATE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    start_date DATE,          -- 갱신이 추가 (중복)
    ...
);
```

PostgreSQL은 이걸 `CREATE TABLE` 파싱 단계에서 거부한다.

```
ERROR:  column "start_date" specified more than once
ERROR:  column "done_date" specified more than once
```

## 왜 두 줄이 스키마 절반을 무너뜨렸나

`milestones`와 `tasks`가 생성되지 않으면, **이 두 테이블을 참조하는 이후 DDL이 전부
연쇄로 실패한다.** 스크립트를 `ON_ERROR_STOP=0`으로 끝까지 돌려 세어보니 에러가 53건
나왔다. 그중 9건은 로컬 환경의 pgvector 부재(아래 참고)이고, **나머지 44건이 위 두 줄
하나에서 파생된 것**이다.

무너진 범위:

| 대상 | 실패 사유 |
|---|---|
| `tasks`, `milestones` | 컬럼 중복 선언 |
| `task_checklists`, `task_comments`, `task_results` | `tasks` FK 참조 불가 |
| `task_result_files`, `task_result_links` | 동일 |
| `github_records.linked_task_id` | 동일 |
| `meeting_action_items.created_task_id` | 동일 |
| `idx_tasks_*`, `idx_milestones_*` | 대상 테이블 없음 |

에러 로그 첫 줄만 보면 `relation "tasks" does not exist`가 압도적으로 많아서,
**진짜 원인(맨 앞 2줄)이 노이즈에 묻힌다.** 로그는 위에서부터 읽어야 한다.

## 조치

중복 선언 두 줄을 제거했다. 컬럼 자체는 기존 위치에 그대로 남아 있으므로
스키마 내용은 달라지지 않는다.

```diff
     created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
-    start_date DATE,
     CONSTRAINT fk_milestones_project FOREIGN KEY (project_id) ...
```

```diff
     extra_fields      JSONB,
-    done_date         DATE,
     CONSTRAINT fk_tasks_project       FOREIGN KEY (project_id) ...
```

커밋: `172eb17` (docs: DB 스키마 스냅샷을 2026-07-26 기준으로 갱신)

## 검증 — 눈으로 읽지 말고 실행해라

리뷰로는 못 잡는다. 실제로 돌려야 한다. 운영 DB는 건드리지 않고,
로컬 dev 컨테이너에 **일회용 DB를 만들어** 전체 DDL을 실행했다.

```bash
docker exec workflow-db psql -U postgres \
  -c "DROP DATABASE IF EXISTS schema_lint_tmp;" \
  -c "CREATE DATABASE schema_lint_tmp;"

# ON_ERROR_STOP=0 - 첫 에러에서 멈추지 말고 전부 수집해야 원인이 몇 개인지 보인다
docker exec -i workflow-db psql -U postgres -d schema_lint_tmp -v ON_ERROR_STOP=0 \
  < docs/db/workflow_ai_schema.sql 2>&1 | grep -E "^ERROR"

docker exec workflow-db psql -U postgres -d schema_lint_tmp -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"

docker exec workflow-db psql -U postgres -c "DROP DATABASE schema_lint_tmp;"
```

수정 후 결과: **테이블 29개 전부 생성**, 헤더에 적힌 개수와 일치.

남은 에러 9건은 전부 로컬 `postgres:17` 이미지에 pgvector가 없어서 나는 것으로,
파일 결함이 아니다(헤더 7~9행에 이미 명시된 요구사항이고 운영 Supabase는 번들 제공).

```
ERROR:  extension "vector" is not available
```

pgvector 전용 구문 2줄만 임시 대체해 재실행하면 `document_chunks`와 신규 인덱스
`idx_document_chunks_project_assignee`까지 정상 생성되는 것도 확인했다.

컬럼 중복만 빠르게 훑고 싶으면 DB 없이도 된다:

```bash
awk '/^CREATE TABLE/{t=$3; delete seen; next} /^\);/{t=""; next}
     t && /^    [a-z_"]+ /{c=$1; gsub(/"/,"",c);
       if (c in seen) print "중복: " t "." c; seen[c]=1}' \
  docs/db/workflow_ai_schema.sql
```

## 남은 것

이 파일은 **아무도 실행하지 않으므로 깨져도 조용하다.** 같은 일이 반복된다.
스냅샷을 갱신할 때는 위 일회용 DB 실행을 통과시키는 것을 조건으로 삼아야 한다.
CI에 넣는다면 `docs/db/workflow_ai_schema.sql`이 변경된 PR에서만 pgvector 포함
이미지(`pgvector/pgvector:pg17`)로 한 번 돌리는 정도면 충분하다 — 그러면 pgvector
구문까지 포함해 전체를 검증할 수 있다.

갱신 방식 자체도 원인의 일부다. 기존 파일에 손으로 컬럼을 덧붙이는 대신
`supabase db dump`의 출력으로 통째로 교체하면 중복이 생길 수 없다.
지금은 덤프를 참고해 손으로 반영하고 있어서 "이미 있는지" 확인이 사람 몫으로 남는다.

## 되돌리는 법

`172eb17`을 revert하면 07-22 기준 스냅샷으로 돌아간다.
운영 스키마·Flyway 마이그레이션과 무관한 문서 파일이라 배포 영향은 없다.
