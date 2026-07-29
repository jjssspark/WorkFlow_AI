# FS-3 대시보드·ML 네이밍 컨벤션

> 최초 작성: 이은주 (FS-7) · FS-3 반영: 유소은 · 최종 코드 대조: 2026-07-27

이 문서는 대시보드 구현의 DB, Spring Boot, FastAPI, React 경계에서 사용하는 이름을 현재 코드 기준으로 정리한다. 팀 공통 규칙은 `convention/backend.md`, `convention/ai.md`, `convention/frontend.md`를 따르며, 아래의 **현재 코드 예외**는 임의로 정규화하지 않는다.

## 1. 계층별 요약

| 계층 | 규칙 | 현재 예시 |
| --- | --- | --- |
| PostgreSQL 테이블 | `snake_case` 복수형 | `tasks`, `milestones`, `ml_predictions` |
| PostgreSQL 컬럼 | `snake_case` | `project_id`, `target_type`, `created_at` |
| Java 패키지 | 소문자 | `dashboard.controller`, `dashboard.service` |
| Java 클래스·record | `PascalCase` | `DashboardService`, `DelayRiskDto` |
| Java 필드·메서드 | `camelCase` | `projectId`, `getProgressDetail` |
| Java 상수 | `UPPER_SNAKE_CASE` | `MODEL_TYPE_DELAY_RISK` |
| Python 모듈·함수·필드 | `snake_case` | `delay_service.py`, `project_id` |
| Python 클래스 | `PascalCase` | `TaskDelayPredictResponse` |
| TypeScript 컴포넌트·타입 | `PascalCase` | `DashboardView`, `ProgressDetailResponse` |
| TypeScript 함수·변수 | `camelCase` | `fetchDashboardProgress`, `projectId` |
| React 훅 | `use` + `PascalCase` | `useDashboardSummary`, `useWorkloadScore` |
| URL 경로 세그먼트 | 소문자 `kebab-case` | `delay-risk`, `workload-score`, `all-tasks` |

### 현재 코드 예외

- 대시보드 DTO 패키지는 현재 `com.workflowai.dashboard.DTO`처럼 `DTO`가 대문자다. 기존 import와 파일 시스템 호환을 위해 그대로 사용하며, 패키지 소문자화는 별도 리팩터링으로 처리한다.
- 프론트 라우트 `dashboard/inprogress`는 현재 붙여 쓰는 경로다. 기존 링크 호환 때문에 유지하며 새 다중 단어 경로는 `kebab-case`를 사용한다.
- Spring의 일반 대시보드 응답은 `camelCase`지만 업무 편중 응답은 FastAPI 계약을 그대로 전달하기 위해 `snake_case`를 유지한다.

## 2. PostgreSQL 테이블·컬럼

### 기본 규칙

- 테이블명은 `snake_case` 복수형을 사용한다.
- PK는 `id BIGSERIAL PRIMARY KEY`, FK 타입은 `BIGINT`를 사용한다.
- 일반 FK는 `{참조 대상 단수}_id`를 사용한다: `project_id`, `task_id`, `milestone_id`.
- 역할이 중요한 FK는 역할명을 사용한다: `assignee_id`, `actor_id`, `author_id`, `created_by`.
- Boolean 컬럼은 의미가 분명한 `is_` 접두사를 사용한다: `is_done`. FastAPI 계산 결과도 `is_anomaly`를 사용한다.
- 날짜는 `*_date`, 시각은 `*_at`으로 구분한다: `due_date`, `done_date`, `created_at`, `updated_at`.
- 현재 기준 DDL의 시각 타입은 `TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`이며 JPA에서는 `LocalDateTime`으로 매핑한다. `TIMESTAMPTZ`로 바꾸려면 전체 서비스의 UTC 변환 정책과 함께 마이그레이션한다.
- JSONB 컬럼은 값의 의미에 맞춰 이름을 정한다. 배열 또는 컬렉션이면 복수형도 허용한다: `deliverables`, `sources`. 무조건 단수형으로 만들지 않는다.

### 제약·인덱스·트리거

- FK 제약: `fk_{테이블 또는 축약}_{대상}` (`fk_predictions_project`)
- UNIQUE 제약: `uq_{테이블}_{컬럼}` (`uq_users_email`)
- CHECK 제약: `chk_{테이블}_{컬럼}`
- 인덱스: `idx_{테이블}_{조회축}` (`idx_tasks_project_milestone`)
- 트리거: `trg_{테이블}_{동작}` (`trg_tasks_updated_at`)
- DB 함수: `snake_case` (`set_updated_at`)

### 다형 참조

- `ml_predictions`는 `target_type` + `target_id` 쌍을 사용한다.
  - 현재 FS-3 값: `target_type='task'`
  - `target_id`: `tasks.id`
- `activities`는 현재 `target_id`만 있고 별도 `target_type`이 없는 예외 구조다. 업무 활동을 조회할 때는 ID만으로 판단하지 말고 반드시 `activities.type`도 함께 제한한다.
- FS-3 지연 위험 피처가 인정하는 업무 활동 타입은 다음과 같다.

```text
TASK_CREATED
STATUS_CHANGED
ASSIGNEE_CHANGED
TASK_UPDATED
TASK_DELETED
CHECKLIST_CREATED
CHECKLIST_COMPLETED
```

## 3. Spring Boot / JPA

### 클래스와 패키지

- Entity는 단수형 `PascalCase`: `Milestone`, `MlPrediction`.
- Controller, Service, Repository는 역할 접미사를 붙인다: `DashboardController`, `DashboardService`, `MlPredictionRepository`.
- 요청 record는 `XxxRequest`, 응답 record는 `XxxResponse`, 목록 항목은 용도가 분명한 `XxxDto`를 사용한다.
  - 요청: `CreateMilestoneRequest`, `UpdateMilestoneRequest`
  - 응답: `DashboardSummaryResponse`, `ProgressDetailResponse`
  - 항목: `DashboardTaskDto`, `DelayRiskDto`, `MilestoneProgressDto`
- 외부 AI 호출 클래스는 `FastApi{기능}Client` 형식을 사용한다: `FastApiDashboardClient`, `FastApiWorkloadScoreClient`.
- Repository 파생 쿼리는 Spring Data 규칙을 그대로 이름에 표현한다: `findByProjectIdAndTargetTypeAndModelTypeOrderByTargetIdAscCreatedAtDesc`.

### 필드와 DB 매핑

- Java 필드는 `camelCase`, DB 컬럼은 `snake_case`를 사용한다.
- 현재 대시보드 Entity는 경계가 분명하도록 `@Column(name = "project_id")`처럼 snake_case 이름을 명시한다. 새 필드도 기존 Entity의 스타일을 따른다.
- Enum을 DB에 저장할 때는 `@Enumerated(EnumType.STRING)`을 사용하고 ordinal은 저장하지 않는다.
- 현재 업무 상태는 Enum이 아니라 영문 소문자 문자열 계약이다.

```text
todo
inprogress
blocked
done
```

### ID 경계

- DB/JPA 내부 ID는 `Long`, FastAPI의 `project_id`와 `task_id`는 Python `int`다.
- Spring 대시보드 URL의 `projectId`는 의도적으로 `String`이다. `DemoDataService.resolveProjectId()`가 `demo-project` 별칭 또는 숫자 문자열을 실제 `Long projects.id`로 변환한다.
- Spring 대시보드 응답 DTO의 ID는 현재 `String`으로 직렬화한다: `id`, `taskId`, `assigneeId`, `actorId`, `targetId`.
- 프론트 API 입력은 데모 별칭과 숫자 ID를 모두 받을 수 있도록 `string | number`를 사용한다.
- 마일스톤 경로 변수 `milestoneId`는 Spring에서 `Long`이며 프론트에서는 URL 조합을 위해 `string`으로 다룬다.

## 4. JSON 필드명과 API 경계

### 일반 대시보드 응답

Spring record 이름을 그대로 직렬화하므로 JSON 필드는 `camelCase`다.

```json
{
  "totalTasks": 14,
  "progressPercent": 29,
  "upcomingDeadlines": [],
  "recentActivity": []
}
```

프론트의 `dashboard/libs/types/dashboard.ts`도 같은 `camelCase`를 유지한다.

### 업무 편중 응답 예외

`ml_workload_score`의 Pydantic 응답은 `snake_case`이며 Spring의 `WorkloadScoreResponseDto`와 `WorkloadScoreMemberDto`도 해당 필드명을 그대로 사용한다.

```text
schema_version
project_id
assignee_id
task_count_total
completion_rate
overload_score
is_anomaly
anomaly_type
task_count_active_rel
difficulty_avg_rel
overdue_count
team_mean_completion
```

프론트는 `workloadScoreApi.ts`의 `RawWorkloadScore*` 타입에서 이 값을 받은 뒤 화면용 `camelCase`로 한 번만 변환한다. 컴포넌트에서 `snake_case` 필드를 직접 사용하지 않는다.

## 5. API 경로

### Spring Boot 대시보드 API

기본 prefix는 `/api/v1/projects/{projectId}/dashboard`다.

```text
GET     /api/v1/projects/{projectId}/dashboard/summary
GET     /api/v1/projects/{projectId}/dashboard/tasks
GET     /api/v1/projects/{projectId}/dashboard/activities
GET     /api/v1/projects/{projectId}/dashboard/progress
GET     /api/v1/projects/{projectId}/dashboard/delay-risk/mine
GET     /api/v1/projects/{projectId}/dashboard/workload-score
POST    /api/v1/projects/{projectId}/dashboard/milestones
PATCH   /api/v1/projects/{projectId}/dashboard/milestones/{milestoneId}
DELETE  /api/v1/projects/{projectId}/dashboard/milestones/{milestoneId}
POST    /api/v1/projects/{projectId}/dashboard/delay-risk/refresh
```

#### 엔드포인트별 역할

아래 표의 경로는 공통 prefix `/api/v1/projects/{projectId}/dashboard` 뒤에 붙는 상대 경로다. 권한은 `DashboardController`에 선언된 메서드 수준 `@PreAuthorize` 기준이며, `-` 표시는 전역 Spring Security 정책과 별개로 해당 메서드에 추가 역할 제한이 없다는 뜻이다.

| 메서드·경로 | 역할 | 주요 응답·처리 | 권한(현재) |
| --- | --- | --- | --- |
| `GET /summary` | 대시보드 홈에 필요한 전체 요약을 한 번에 조회한다. 전체·완료·블로커·진행 중 업무 수, 마감 임박 업무 최대 5건, 심사자를 제외한 팀원별 업무량, 최근 활동 최대 10건을 조합한다. | `DashboardSummaryResponse` | - |
| `GET /tasks` | 전체 업무, 블로커, 진행 중, 긴급 업무 등 대시보드 상세 화면의 공통 원본 업무 목록을 조회한다. | 상태와 칸반 위치 순으로 정렬된 `List<DashboardTaskDto>` | - |
| `GET /activities` | 프로젝트 활동 내역 화면에 사용할 최근 활동을 조회한다. 행위자 이름을 함께 조합한다. | 최신순 최대 50건의 `List<ActivityItemDto>` | - |
| `GET /progress` | 전체 진행률 화면의 집계 데이터를 조회한다. 마일스톤별·카테고리별 완료율, 프로젝트 일정, 최신 AI 지연 위험도를 함께 반환한다. | `ProgressDetailResponse`; 지연 위험도는 업무별 최신 예측 중 `정상`을 제외한 `주의`·`위험`만 포함 | - |
| `GET /delay-risk/mine` | 로그인 사용자가 담당한 업무 중 조치가 필요한 지연 위험 업무만 조회한다. | 현재 사용자 담당 + 최신 예측 + `정상` 제외 조건의 `List<DelayRiskDto>` | `@projectAccess.isMember` |
| `GET /workload-score` | FastAPI 업무 편중 모델을 호출해 팀원별 과부하·저배정 이상치를 실시간 계산한다. | `WorkloadScoreResponseDto`; DB에 저장하지 않으며 AI 호출 실패 시 HTTP 503과 `WORKLOAD_SCORE_UNAVAILABLE` 반환 | `@projectAccess.isMember` |
| `POST /milestones` | 새 마일스톤을 생성하고 프로젝트 구성원에게 생성 알림을 보낸다. | 진행률 0%의 `MilestoneProgressDto` | `@projectAccess.hasRole(..., 'LEADER')` |
| `PATCH /milestones/{milestoneId}` | 대상 마일스톤이 현재 프로젝트 소속인지 확인한 뒤 이름·시작일·마감일을 수정한다. 실제 변경이 있으면 구성원에게 알린다. | 연결 업무를 반영한 최신 `MilestoneProgressDto` | `@projectAccess.hasRole(..., 'LEADER')` |
| `DELETE /milestones/{milestoneId}` | 연결 업무의 `milestone_id`를 먼저 `NULL`로 해제한 뒤 마일스톤을 삭제하고 구성원에게 알린다. 업무 자체는 삭제하지 않는다. | 성공 시 `ApiResponse<Void>` | `@projectAccess.hasRole(..., 'LEADER')` |
| `POST /delay-risk/refresh` | FastAPI 지연 위험 예측을 다시 실행한 뒤 갱신된 진행률 데이터를 조회한다. | `ProgressDetailResponse`; FastAPI 실패 시 예외를 전파하지 않고 기존 `ml_predictions` 최신값으로 응답 | - |

- 경로 변수는 Java 규칙에 맞춰 `camelCase`: `{projectId}`, `{milestoneId}`.
- 리소스명은 복수 명사: `tasks`, `activities`, `milestones`.
- 여러 단어 경로는 `kebab-case`: `delay-risk`, `workload-score`.
- 동작이 필요한 경우에만 마지막 세그먼트에 동사를 둔다: `refresh`.
- 프론트 `apiFetch`의 `API_BASE_URL`이 `/api/v1`을 포함하므로 기능별 API 유틸에서는 `/projects/...`부터 작성한다.
- Spring 응답은 공통 envelope `{ success, data, error }`를 사용한다.

### FastAPI 내부 API

```text
GET   /ai/predict/delay/health
POST  /ai/predict/delay/tasks/predict?project_id={projectId}
POST  /ai/score/workload?project_id={projectId}&use_synthetic_fallback=false
```

#### 엔드포인트별 역할

| 메서드·경로 | 역할 | 주요 응답·실패 처리 |
| --- | --- | --- |
| `GET /ai/predict/delay/health` | 지연 위험 서비스가 실행 중인지와 모델 아티팩트를 로드할 수 있는지 확인한다. | `HealthResponse`; 서비스 상태 `UP`과 `model_loaded` Boolean을 반환한다. 모델 파일이 없으면 `model_loaded=false`다. |
| `POST /ai/predict/delay/tasks/predict` | 프로젝트의 미완료 업무를 일괄 조회하고 지연 위험을 예측한다. 예측 결과는 `ml_predictions`에 append-only 방식으로 추가한다. | `TaskDelayPredictResponse`; `project_id`, `predicted_count`, 업무별 `results` 반환. 모델 아티팩트가 없으면 HTTP 503이다. |
| `POST /ai/score/workload` | 프로젝트 업무를 기준으로 팀원별 상대 업무량·완료율·난이도·기한 초과를 계산하고 MAD 또는 Isolation Forest로 편중 이상치를 탐지한다. | `WorkloadScoreResponse`; 저장하지 않는 라이브 계산이다. `use_synthetic_fallback=false`가 운영 기본값이며 실패 시 HTTP 500과 `WORKLOAD_SCORE_FAILED`를 반환한다. |

- 쿼리 파라미터와 Pydantic 필드는 `snake_case`: `project_id`, `use_synthetic_fallback`.
- Python 라우터 변수명은 `router`, 함수는 동작을 나타내는 `snake_case`: `predict_tasks_for_project`, `score_workload`.
- Spring이 FastAPI를 호출할 때 외부 URL의 `projectId` 문자열을 해석한 뒤 숫자 `Long`을 `project_id`로 전달한다.

## 6. ML 모델·결과 값

### 지연 위험도 (`ml_delay_risk`)

- DB 모델 구분값: `model_type='delay_risk'`
- DB 대상 구분값: `target_type='task'`
- FastAPI Enum: `NORMAL`, `CAUTION`, `DANGER`
- DB·화면 표시값: `정상`, `주의`, `위험`
- `score`: 선택된 위험 등급의 확신도 `0`~`1`
- API 필드: `risk_class`, `class_probabilities`, `predicted_count`
- `ml_predictions`는 갱신하지 않고 실행마다 행을 추가하는 append-only 이력이다.
- 최신값은 `(project_id, target_type, model_type)`으로 조회한 뒤 `target_id`별 `created_at DESC` 첫 행을 사용한다.
- 완료 업무는 재예측 대상에서 제외하며, 삭제된 업무의 과거 예측은 화면 응답에서 제외한다.

### 업무 편중 (`ml_workload_score`)

- DB에 저장하지 않고 호출 시점마다 계산하는 라이브 응답이다.
- 스키마 버전 상수: `CURRENT_WORKLOAD_SCHEMA_VERSION = "1.0"`
- `source`: `db` 또는 `synthetic_fallback`
- `method`: `MAD (소규모 팀)` 또는 `Isolation Forest (대규모)`
- 현재 모델의 `anomaly_type`: `정상`, `과부하 의심`, `배정량 불균형`
- 실패 코드: FastAPI `WORKLOAD_SCORE_FAILED`, Spring 외부 응답 `WORKLOAD_SCORE_UNAVAILABLE`

## 7. React / TypeScript

- 기능 루트는 `dashboard/`, 하위는 `screen/`, `components/`, `libs/hooks`, `libs/types`, `libs/utils`로 구분한다.
- 화면·컴포넌트 파일은 `PascalCase.tsx`: `DashboardView.tsx`, `WorkloadPage.tsx`, `MilestoneAddPopup.tsx`.
- 훅·API·유틸 파일은 `camelCase.ts`: `useDashboardTasks.ts`, `dashboardApi.ts`, `dashboardTaskUtils.ts`.
- 테스트 파일은 대상 파일명 뒤에 `.test`를 붙인다: `DashProgressPage.test.tsx`, `useDashboardTasks.test.ts`.
- 인터페이스와 타입은 `PascalCase`: `DashboardTaskDto`, `CreateMilestoneInput`, `DelayRiskResult`.
- 함수·변수는 `camelCase`, Boolean은 `is`, `has`, `should`, `can` 접두사를 우선한다.
- 상수는 `UPPER_SNAKE_CASE`: `VALID_STATUSES`, `RISK_SORT_ORDER`.
- API 호출은 `dashboard/libs/utils`에 모으고 컴포넌트에서 직접 `fetch`하지 않는다.

## 8. 현재 코드 동기화 확인 사항

- FastAPI `WorkloadMemberResult`에는 `task_count_total_rel`이 있지만 Spring `WorkloadScoreMemberDto`와 프론트 `RawWorkloadScoreMember`에는 아직 없다. 화면에서 사용할 경우 세 계층의 필드를 함께 추가한다.
- 업무 편중 모델의 현재 저배정 라벨은 `배정량 불균형`이지만 `WorkloadPage`에는 과거 값인 `저활동 의심` 표시 로직이 남아 있다. 라벨을 바꿀 때 모델·Spring·프론트·테스트를 동시에 갱신한다.
- `activities`에 `target_type`을 추가하기 전까지 FS-3 피처 쿼리는 `TASK_ACTIVITY_TYPES` 화이트리스트를 단일 기준으로 유지한다.
- `ml_predictions` 최신값 조회 인덱스를 추가한다면 현재 조회 순서에 맞춰 `(project_id, target_type, model_type, target_id, created_at DESC)`를 사용하고 `idx_ml_predictions_latest`처럼 명명한다.
- 시각 컬럼을 `TIMESTAMPTZ`로 전환할 경우 `UtcTimeFormat`, FastAPI pandas 변환, 기존 `LocalDateTime` 매핑을 함께 검증한다.

## 9. 기준 코드

- `App/backend_spring/src/main/java/com/workflowai/dashboard/`
- `App/backend_spring/src/main/java/com/workflowai/common/DemoDataService.java`
- `App/backend_spring/src/main/resources/db/init/01_base_schema.sql`
- `App/backend_fastapi/ml_delay_risk/`
- `App/backend_fastapi/ml_workload_score/`
- `App/frontend/src/dashboard/`
- `App/frontend/src/global/api/apiClient.ts`
- `App/frontend/src/routes/router.tsx`
