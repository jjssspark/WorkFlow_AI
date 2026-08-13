# WorkFlow AI API 명세서

## 1. 문서 정보

| 항목 | 내용 |
| --- | --- |
| 제품명 | WorkFlow AI |
| 문서 목적 | 프론트엔드, 백엔드, AI 백엔드가 공유하는 API 계약 정의 |
| 적용 범위 | 인증, 프로젝트, 회의록, 업무 보드, 대시보드, Assistant, 기여도, 평가 |
| API 버전 | `v1` |
| 기본 경로 | `/api/v1` |
| 응답 형식 | JSON |

> 본 문서의 REST 경로 표기는 별도 설명이 없는 한 `/api/v1` 기준의 상대 경로이다.

> **미구현 안내 (2026-08-13 갱신)**
> **`3.8 산출물 생성`의 엔드포인트는 실제로 존재하지 않는다.** 호출하면 404가 난다.
> 산출물 생성과 GitHub 동기화는 계획했으나 구현하지 않았고, 엔티티·리포지토리만 남아 있다.
> 해당 절과 `4.4 산출물` 스키마, `DELIVERABLE_NOT_FOUND` 에러 코드는 기획 시점의 계약 기록으로 남겨둔다.
> 프로젝트 생성·수정의 `deliverables`(목표 산출물) 필드는 위와 별개로 정상 동작한다.

## 2. 공통 규칙

### 2.1 인증

- 대부분의 API는 `Authorization: Bearer <access_token>` 헤더가 필요하다.
- Access Token 만료 시 `POST /api/v1/auth/refresh`로 재발급한다.
- 로그인은 Google OAuth 2.0 기반이며, 서버는 자체 JWT를 발급한다.
- 프로젝트별 권한은 `project_members.role` 기준으로 판단한다.

### 2.2 공통 응답 형식

모든 성공 응답은 다음 envelope를 사용한다.

```json
{
  "success": true,
  "data": {}
}
```

오류 응답은 다음 형식을 사용한다.

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "로그인이 필요합니다.",
    "details": {}
  }
}
```

### 2.3 공통 상태 코드

| 상태 코드 | 의미 |
| --- | --- |
| `200 OK` | 조회/수정 성공 |
| `201 Created` | 생성 성공 |
| `204 No Content` | 삭제 또는 본문 없는 성공 |
| `400 Bad Request` | 요청 값 오류 |
| `401 Unauthorized` | 인증 실패 |
| `403 Forbidden` | 권한 부족 |
| `404 Not Found` | 리소스 없음 |
| `409 Conflict` | 중복 또는 상태 충돌 |
| `422 Unprocessable Entity` | 업로드/검증 실패 |
| `429 Too Many Requests` | 요청 제한 초과 |
| `500 Internal Server Error` | 서버 내부 오류 |

### 2.4 권한 규칙

| 역할 | 권한 |
| --- | --- |
| 팀장 | 프로젝트 생성, 팀원 초대, 업무 생성/배정, 회의록 승인, 산출물 검토 |
| 팀원 | 본인 업무 조회/수정, 회의록 업로드, 개인 코멘트 작성 |
| 심사자 | 기여도 리포트 조회, AI 평가 근거 조회, 최종 점수 입력 |

### 2.5 비동기 처리

- 회의록 분석, STT, GitHub 동기화, 산출물 생성, RAG 인덱싱은 비동기 작업으로 처리할 수 있다.
- 비동기 작업은 `jobId` 또는 `analysisStatus`를 반환하고 폴링으로 상태를 확인한다.
- 결과가 준비되면 관련 엔티티(`meetings`, `deliverables`, `ml_predictions`)에 저장한다.

### 2.6 파일 업로드 규칙

- 허용 형식은 기능별로 명시한다.
- 업로드 응답은 파일 메타데이터와 처리 상태를 함께 반환한다.
- 대용량 파일은 업로드 직후 분석하지 않고 비동기 작업으로 넘긴다.

## 3. 도메인별 API

## 3.1 인증

### `GET /auth/google`

Google OAuth 인가 URL로 리다이렉트한다.

### `GET /auth/google/callback`

OAuth code를 받아 로그인 또는 회원가입을 처리하고 JWT를 발급한다.

#### Query

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| `code` | string | Y | Google Authorization Code |
| `state` | string | N | CSRF 방지용 state |

#### 성공 응답

```json
{
  "success": true,
  "data": {
    "accessToken": "eyJ...",
    "refreshToken": "eyJ...",
    "expiresIn": 1800,
    "user": {
      "id": 1,
      "email": "user@example.com",
      "name": "Kim Minsoo"
    }
  }
}
```

### `POST /auth/refresh`

Refresh Token으로 Access Token을 재발급한다.

#### Request

```json
{
  "refreshToken": "eyJ..."
}
```

### `POST /auth/logout`

Refresh Token을 폐기하고 로그아웃한다.

---

## 3.2 사용자 및 내 정보

### `GET /me`

현재 로그인한 사용자의 기본 정보와 역할 요약을 조회한다.

### `GET /me/tasks`

내가 담당한 업무 목록을 조회한다.

### `GET /me/comments`

내가 받은 개인 코멘트와 내가 작성한 코멘트를 조회한다.

---

## 3.3 프로젝트

### `GET /projects`

사용자가 접근 가능한 프로젝트 목록을 조회한다.

### `POST /projects`

프로젝트를 생성한다. 팀장만 가능하다.

#### Request

```json
{
  "title": "WorkFlow AI",
  "type": "캡스톤디자인",
  "deadline": "2026-08-31",
  "description": "AI 기반 협업 및 평가 보조 플랫폼"
}
```

### `GET /projects/{projectId}`

프로젝트 상세 정보를 조회한다.

### `PATCH /projects/{projectId}`

프로젝트 제목, 설명, 마감일을 수정한다. 팀장만 가능하다.

### `DELETE /projects/{projectId}`

프로젝트를 삭제한다. 팀장만 가능하다.

### `POST /projects/{projectId}/invitations`

팀원 또는 심사자 초대 링크를 생성한다.

#### Request

```json
{
  "email": "reviewer@example.com",
  "role": "심사자"
}
```

### `POST /invitations/{token}/accept`

초대 토큰을 사용해 프로젝트 참여를 수락한다.

### `GET /projects/{projectId}/members`

프로젝트 멤버 목록과 역할을 조회한다.

### `PATCH /projects/{projectId}/members/{userId}/role`

프로젝트 멤버의 역할을 변경한다. 팀장만 가능하다.

---

## 3.4 업무 보드

### `GET /projects/{projectId}/tasks`

프로젝트의 모든 업무를 조회한다. 상태, 카테고리, 담당자, 마감일로 필터링할 수 있다.

### `POST /projects/{projectId}/tasks`

업무를 생성한다.

#### Request

```json
{
  "title": "회의록 AI 분석 UI 구현",
  "category": "프론트엔드",
  "status": "할 일",
  "assigneeId": 3,
  "dueDate": "2026-07-20",
  "priority": "높음",
  "description": "회의록 업로드 후 결과 화면 추가"
}
```

### `GET /tasks/{taskId}`

업무 상세를 조회한다.

### `PATCH /tasks/{taskId}`

업무 상태, 담당자, 마감일, 우선순위, 설명을 수정한다.

### `DELETE /tasks/{taskId}`

업무를 삭제한다.

### `POST /tasks/{taskId}/checklists`

업무 체크리스트를 추가한다.

### `PATCH /tasks/{taskId}/checklists/{checklistId}`

체크리스트의 완료 여부를 수정한다.

### `DELETE /tasks/{taskId}/checklists/{checklistId}`

체크리스트를 삭제한다.

---

## 3.5 회의록 AI

### `POST /projects/{projectId}/meetings`

회의록 파일 또는 녹음 파일을 업로드한다.

#### Content Type

`multipart/form-data`

#### Form Data

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| `file` | file | Y | 문서, 음성, 영상 파일 |
| `fileType` | string | Y | `document`, `audio`, `video` |
| `attendeeIds` | number[] | N | 참석자 userId 목록 |
| `title` | string | N | 회의 제목 |

### `POST /meetings/{meetingId}/transcribe`

회의 파일을 STT로 전사한다.

### `POST /meetings/{meetingId}/analyze`

회의 텍스트를 분석해 요약, 결정사항, 위험요소, To-Do 후보를 생성한다.

### `GET /meetings/{meetingId}`

회의록의 분석 상태와 결과를 조회한다.

### `POST /meetings/{meetingId}/todos/approve`

AI가 제안한 To-Do 후보를 업무로 확정한다.

#### Request

```json
{
  "approvedItems": [
    {
      "title": "프론트엔드 결과 화면 추가",
      "assigneeId": 3,
      "dueDate": "2026-07-20",
      "priority": "높음"
    }
  ]
}
```

---

## 3.6 대시보드

### `GET /projects/{projectId}/dashboard/summary`

전체 진행률, 마감 D-day, 지연 업무, 최근 활동을 반환한다.

### `GET /projects/{projectId}/dashboard/workload`

팀원별 업무량과 과부하 점수를 조회한다.

### `GET /projects/{projectId}/predictions`

ML 예측 결과를 조회한다.

#### Query

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| `type` | string | Y | `delay` 또는 `overload` |

---

## 3.7 AI Assistant

### `POST /projects/{projectId}/assistant/ask`

프로젝트 데이터 기반 질문에 답변한다.

#### Request

```json
{
  "message": "이번 주에 가장 위험한 업무는 뭐야?"
}
```

#### 성공 응답

```json
{
  "success": true,
  "data": {
    "answer": "프론트엔드 결과 화면 추가 업무가 마감일 대비 진행률이 낮아 위험합니다.",
    "sources": [
      {
        "sourceType": "task",
        "sourceId": 18,
        "title": "프론트엔드 결과 화면 추가"
      }
    ]
  }
}
```

### `GET /projects/{projectId}/assistant/history`

프로젝트별 AI Assistant 대화 이력을 조회한다.

---

## 3.8 산출물 생성 — 미구현 (엔드포인트 없음)

### `POST /projects/{projectId}/deliverables`

산출물 초안 생성을 요청한다.

#### Request

```json
{
  "type": "README",
  "title": "WorkFlow AI README 초안",
  "options": {
    "tone": "정제된",
    "includeSections": ["소개", "기술 스택", "실행 방법", "API"]
  }
}
```

### `GET /deliverables/{deliverableId}`

산출물 상세와 생성 상태를 조회한다.

### `PATCH /deliverables/{deliverableId}`

산출물 내용을 수정한다.

### `POST /deliverables/{deliverableId}/finalize`

산출물을 확정 상태로 전환한다.

---

## 3.9 기여도 및 평가

### `GET /projects/{projectId}/contributions`

심사자 전용 기여도 리포트 목록을 조회한다.

### `GET /projects/{projectId}/members/{userId}/contribution`

특정 팀원의 기여도 상세를 조회한다. 심사자만 가능하다.

### `POST /projects/{projectId}/comments`

개인 또는 팀 코멘트를 작성한다.

#### Request

```json
{
  "targetType": "personal",
  "targetUserId": 3,
  "content": "이번 주 작업 속도가 안정적입니다."
}
```

### `GET /projects/{projectId}/comments`

프로젝트 코멘트 목록을 조회한다.

### `POST /projects/{projectId}/scores`

최종 평가 점수를 입력한다. 심사자만 가능하다.

#### Request

```json
{
  "userId": 3,
  "score": 92,
  "isPublic": false
}
```

### `PATCH /projects/{projectId}/scores/{scoreId}/visibility`

평가 점수 공개 여부를 변경한다.

---

## 3.10 GitHub 연동

### `POST /projects/{projectId}/github/connect`

프로젝트 저장소를 연결한다.

### `GET /projects/{projectId}/github/records`

동기화된 GitHub 활동 기록을 조회한다.

### `POST /github/webhook`

GitHub webhook 이벤트를 수신한다.

---

## 3.11 마일스톤

### `GET /projects/{projectId}/milestones`

프로젝트 마일스톤을 조회한다.

### `POST /projects/{projectId}/milestones`

프로젝트 마일스톤을 생성한다.

#### Request

```json
{
  "title": "중간발표",
  "dueDate": "2026-08-10"
}
```

---

## 4. AI 백엔드 API

AI 백엔드는 Spring Boot가 내부 호출하는 별도 서비스이며, `/ai` prefix를 사용한다.

### 4.1 회의록 AI

- `POST /ai/stt/transcribe`
- `POST /ai/meeting/analyze`

### 4.2 RAG

- `POST /ai/rag/index`
- `POST /ai/rag/ask`

### 4.3 대시보드 예측

- `POST /ai/ml/delay-risk`
- `POST /ai/ml/overload`
- `POST /ai/llm/recommend-actions`

### 4.4 산출물 — 미구현 (스키마만)

- `POST /ai/deliverable/generate`
- `POST /ai/deliverable/refine`

### 4.5 기여도

- `POST /ai/contribution/summarize`
- `POST /ai/ml/anomaly`

---

## 5. 핵심 데이터 모델

| 엔티티 | 주요 필드 |
| --- | --- |
| `users` | `id`, `email`, `name`, `provider`, `provider_id` |
| `projects` | `id`, `title`, `type`, `deadline`, `description` |
| `project_members` | `id`, `project_id`, `user_id`, `role` |
| `invitations` | `id`, `project_id`, `email`, `role`, `token`, `status`, `expires_at` |
| `tasks` | `id`, `project_id`, `title`, `category`, `status`, `assignee_id`, `due_date`, `priority` |
| `task_checklists` | `id`, `task_id`, `title`, `is_done` |
| `meetings` | `id`, `project_id`, `file_type`, `transcript`, `file_path` |
| `meeting_attendees` | `id`, `meeting_id`, `user_id` |
| `meeting_analysis` | `meeting_id`, `summary`, `decisions`, `risks`, `action_items` |
| `activities` | `id`, `project_id`, `actor_id`, `type`, `target_id`, `created_at` |
| `github_records` | `id`, `project_id`, `type`, `title`, `author`, `url`, `linked_task_id` |
| `deliverables` | `id`, `project_id`, `type`, `title`, `content`, `status`, `file_path` |
| `ml_predictions` | `id`, `project_id`, `target_type`, `target_id`, `model_type`, `result`, `score` |
| `contribution_reports` | `id`, `project_id`, `user_id`, `summary`, `evidence` |
| `evaluation_scores` | `id`, `project_id`, `user_id`, `score`, `is_public` |
| `audit_logs` | `id`, `user_id`, `action`, `target_type`, `target_id` |

## 6. 오류 코드

| 코드 | 의미 |
| --- | --- |
| `UNAUTHORIZED` | 인증 토큰이 없거나 유효하지 않음 |
| `FORBIDDEN` | 역할 또는 프로젝트 권한 부족 |
| `PROJECT_NOT_FOUND` | 프로젝트를 찾을 수 없음 |
| `TASK_NOT_FOUND` | 업무를 찾을 수 없음 |
| `MEETING_NOT_FOUND` | 회의록을 찾을 수 없음 |
| `DELIVERABLE_NOT_FOUND` | 산출물을 찾을 수 없음 |
| `INVITATION_EXPIRED` | 초대 토큰이 만료됨 |
| `INVALID_FILE_TYPE` | 허용되지 않는 파일 형식 |
| `ANALYSIS_NOT_READY` | AI 분석이 아직 완료되지 않음 |
| `DUPLICATE_MEMBER` | 이미 프로젝트 멤버로 존재함 |
| `INVALID_ROLE` | 잘못된 역할 값 |

## 7. 설계 원칙

- REST 리소스는 프로젝트 단위로 묶는다.
- AI 기능은 직접 노출하지 않고, 서비스 API에서 감싼다.
- 심사자 전용 데이터는 반드시 서버에서 차단한다.
- 분석 상태가 필요한 기능은 동기 응답과 비동기 작업 상태를 분리한다.
- 응답 스키마는 프론트엔드에서 공통 처리 가능하도록 유지한다.
