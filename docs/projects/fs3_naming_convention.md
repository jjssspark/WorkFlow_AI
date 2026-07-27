# FS-3 DB 네이밍 컨벤션

> 작성: 이은주 (FS-7) · 다른 오너 테이블도 이 컨벤션 따라주면 충돌 없이 JOIN 가능
> 수정: 유소은 (FS-3) · 잘 사용하겠습니다 감사합니다 :D

## 1. 테이블 / 컬럼
- 테이블명: `snake_case`, 복수형 (`ml_predictions`, `task_checklists`)
- 컬럼명: `snake_case`
- PK: 모든 테이블 `id BIGSERIAL PRIMARY KEY` (UUID 안 씀 — Spring Data JPA `Long id` 기본값과 맞춤)
- FK: `{참조테이블_단수}_id` (`project_id`, `task_id`, `user_id`)
- Boolean: `is_` 접두사 (`is_done`, `is_overdue`)
- 시각: `created_at`, `updated_at` (`TIMESTAMPTZ`, `DEFAULT now()`)
- 다형 참조: `{대상}_type` + `{대상}_id` 쌍 (`target_type`, `target_id`)으로 저장하고, 허용 값은 영문 소문자 단수형 (`task`, `user`) 사용
- JSON 저장: `JSONB` 타입, 컬럼명은 단수 (`feature`, 배열이어도 단수 유지 — 데이터 묶음 자체를 지칭)

## 2. Java 엔티티 (Spring Boot / JPA)
- 클래스명: `PascalCase` 단수형 (`MlPrediction`, `DashboardTask`)
- 필드명: `camelCase` (`projectId`, `targetType`, `createdAt`) — Spring의 기본 `CamelCaseToUnderscoresNamingStrategy`가 자동으로 `snake_case` 컬럼에 매핑하므로 `@Column(name=...)` 명시 안 해도 됨. 단, 매핑 안 되는 예외 케이스만 명시.
- DTO명: 요청은 `XxxRequest`, 응답은 `XxxResponse` 또는 용도가 분명한 `XxxDto` (`CreateMilestoneRequest`, `DashboardSummaryResponse`, `DelayRiskDto`)
- Enum 저장: `@Enumerated(EnumType.STRING)` + DB는 `VARCHAR` + `CHECK` 제약 (숫자 ordinal 저장 금지 — 나중에 값 추가/순서가 바뀌면 깨짐)
- ML 예측 상수: DB에는 영문 `snake_case` 값 사용 (`target_type='task'`, `model_type='delay_risk'`), 화면 표시 문구와 분리

## 3. API 경로 (FS-3 담당 엔드포인트, 현재 구현 기준)
```text
GET   /api/v1/projects/{projectId}/dashboard/summary
GET   /api/v1/projects/{projectId}/dashboard/tasks
GET   /api/v1/projects/{projectId}/dashboard/activities
GET   /api/v1/projects/{projectId}/dashboard/progress
GET   /api/v1/projects/{projectId}/dashboard/delay-risk/mine
GET   /api/v1/projects/{projectId}/dashboard/workload-score
POST  /api/v1/projects/{projectId}/dashboard/milestones
POST  /api/v1/projects/{projectId}/dashboard/delay-risk/refresh

GET   /ai/predict/delay/health
POST  /ai/predict/delay/tasks/predict?project_id={projectId}  (FastAPI)
```

- Spring Boot 경로 변수는 `camelCase` (`projectId`), FastAPI 쿼리 파라미터와 Pydantic 필드는 `snake_case` (`project_id`)를 사용한다.
- 리소스 경로는 복수 명사, 동작이 필요한 경우에만 마지막 세그먼트에 동사를 사용한다 (`refresh`, `predict`).

## 4. 프로젝트 문서 / 구현 대조 결과 (2026-07-23 확인)
- DB: 현재 실행 구성(`App/docker-compose.yml`)은 **PostgreSQL 17**. 공통 PK/FK 규칙과 `ml_predictions` 스키마는 PostgreSQL 기준으로 유지한다.
- FS-3 담당 범위는 대시보드 집계와 지연 위험도 예측이다. 예측 입력은 `tasks`, `milestones`, `task_checklists`에서 조회하고 결과는 `ml_predictions`에 저장한다.
- `ml_predictions`의 FS-3 저장 규칙:
  - `target_type='task'`
  - `target_id=tasks.id`
  - `model_type='delay_risk'` (알고리즘명 `lightgbm`과 구분)
  - `result`: `정상` / `주의` / `위험`
  - `score`: 선택된 위험 등급의 확신도 (`0`~`1`)
  - `created_at`: 예측 실행 시각
- 예측 결과는 기존 행을 갱신하지 않고 매 실행마다 새 행을 추가하는 **append-only 이력**으로 관리한다. `(project_id, target_type, target_id, model_type)` 유니크 제약은 두지 않고, 조회 시 `target_id`별 최신 `created_at` 행을 사용한다.
- FastAPI 응답의 `risk_class`는 `NORMAL` / `CAUTION` / `DANGER`, DB와 화면용 `result`는 `정상` / `주의` / `위험`으로 구분한다.
- **현재 DDL 예외:** `ml_predictions.created_at`은 `TIMESTAMP DEFAULT CURRENT_TIMESTAMP`로 정의되어 있어 팀 공통 시각 규칙인 `TIMESTAMPTZ DEFAULT now()`와 다르다. 스키마 변경 전 DB 담당자와 마이그레이션 여부를 확정해야 한다.
- **ID 타입 확인 필요:** DB/FastAPI의 `project_id`는 `BIGINT`/`int`인데 Spring 대시보드 경로 변수는 현재 `String projectId`다. 데모용 문자열 ID와 운영용 숫자 ID를 혼용하지 않도록 API 경계 타입을 팀에서 확정한다.

## 5. 다른 오너에게 요청할 것
- FS-1(박상준): `projects.id`의 운영 타입과 대시보드 API의 `projectId` 타입 확정, 프로젝트 접근 권한(`@PreAuthorize`) 적용 범위 공유 요청
- FS-2(박지수): 대시보드 최근 활동에 노출할 회의록/To-Do 활동의 `activities.type` 값과 생성 시점 규칙 공유 요청
- FS-5(이은주): 업무편중점수 모델 입력 피처명, 모델 아티팩트 버전, 사용법 등 공유 요청
- FS-6(허영주): `tasks`/`milestones`/`task_checklists`의 상태·마감일·진행률 컬럼명 및 상태 Enum 값 변경 시 대시보드와 동시 반영 요청
- DB 설계 담당자: `ml_predictions.created_at`의 `TIMESTAMPTZ` 전환 여부와 인덱스 `(project_id, target_type, model_type, target_id, created_at DESC)` 반영 검토 요청
