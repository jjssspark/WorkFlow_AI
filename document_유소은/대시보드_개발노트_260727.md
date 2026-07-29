# 대시보드 전체 개발 정리

> 담당 영역: 대시보드
> 작성 기준일: 2026-07-27
> 기준 브랜치: feature/fs3_ml-delay-risk
> 기준 범위: 현재 작업 트리(커밋 완료분 + 로컬 미커밋 변경 포함)

## 1. 개발 개요

대시보드는 프로젝트의 업무 현황을 한 화면에서 요약하고, 진행률·블로커·마감 임박 업무·팀원별 업무량·최근 활동을 상세 화면에서 관리하는 기능이다.

현재 구현 범위는 다음과 같다.

- React 기반 대시보드 홈 1개와 상세 화면 8개
- Spring Boot 기반 대시보드 조회·마일스톤 관리 API 10개
- PostgreSQL/Supabase의 업무·마일스톤·활동·ML 예측 데이터 연동
- FastAPI 지연 위험도 모델 연동
- FastAPI 업무 편중 점수 모델 연동
- 팀장/팀원 역할에 따른 업무 처리 및 완료 승인 흐름
- 대시보드 전용 공통 훅, 데이터 타입, 날짜·상태·위험도 유틸리티
- 프론트엔드, Spring, FastAPI 단위·통합 테스트

## 2. 기술 구성

| 구분 | 사용 기술 | 역할 |
|---|---|---|
| 프론트엔드 | React 19, TypeScript, Vite | 대시보드 9개 화면과 팝업, 상태 관리 |
| UI | Tailwind CSS, Lucide React | 반응형 레이아웃, 카드·배지·아이콘 |
| 차트 | Recharts, 자체 SVG 차트 | 진행률, 완료 빈도, 팀원별 업무량 시각화 |
| API 서버 | Spring Boot 3.5, Java 21 | 집계 API, 권한, 마일스톤, FastAPI 중계 |
| 데이터 | PostgreSQL/Supabase, JPA | tasks, milestones, activities, ml_predictions 조회 |
| AI/ML 서버 | FastAPI, pandas, scikit-learn | 지연 위험도 및 업무 편중 점수 계산 |
| ML 관측 | LangSmith | 업무 편중 계산 흐름의 요약 트레이싱 |
| 테스트 | Vitest, JUnit/MockMvc, pytest | 프론트·Spring·FastAPI 회귀 검증 |

## 3. 전체 구조와 데이터 흐름

~~~mermaid
flowchart LR
    U["사용자"]
    FE["React 대시보드<br/>9개 화면"]
    SP["Spring Boot<br/>DashboardController / Service"]
    DB[("PostgreSQL / Supabase")]
    DR["FastAPI<br/>ml_delay_risk"]
    WL["FastAPI<br/>ml_workload_score"]
    RAG["AI 어시스턴트 / RAG"]

    U --> FE
    FE -->|"/api/v1/projects/{projectId}/dashboard/*"| SP
    FE -->|"업무 수정·댓글·완료 요청"| SP
    FE -.->|"직접 질문 기능"| RAG
    SP --> DB
    SP -->|"지연 위험 재분석"| DR
    DR -->|"미완료 업무 예측 결과 적재"| DB
    SP -->|"업무 편중 라이브 계산"| WL
    WL --> DB
~~~

핵심 데이터 흐름은 다음과 같다.

1. 프론트엔드가 현재 프로젝트 ID로 요약, 업무, 진행률, 활동 API를 병렬 조회한다.
2. Spring이 업무·마일스톤·활동·최신 ML 예측을 집계해 화면용 DTO로 반환한다.
3. 지연 위험도는 FastAPI가 미완료 업무를 예측해 ml_predictions에 저장하고 Spring이 최신값을 읽는다.
4. 업무 편중 점수는 FastAPI가 호출 시점마다 계산해 Spring을 거쳐 그대로 반환한다.
5. 업무 상태·담당자·마감일·댓글 변경은 기존 업무 보드 API를 재사용한다.

## 4. 프론트엔드 화면 구현

대시보드 라우트는 모두 로그인 후 AppShell 내부에서 접근한다.

| 번호 | 경로 | 화면 | 핵심 기능 |
|---:|---|---|---|
| 1 | /dashboard | 대시보드 홈 | 핵심 지표, 진행률, 마감, 업무량, 최근 활동, 빠른 액션 |
| 2 | /dashboard/all-tasks | 전체 업무 관리 | 검색·필터·정렬, 상태 변경, 상세·댓글, 회의록 AI 업무 확인 |
| 3 | /dashboard/progress | 진행률 분석 | 완료율, 완료 업무, 팀원·카테고리·마일스톤 분석 |
| 4 | /dashboard/blockers | 블로커 관리 | 블로커 심각도·지속시간·지연 위험 분석 및 해결 처리 |
| 5 | /dashboard/inprogress | 진행 중 업무 모니터링 | 미업데이트 업무, 지연 예상, 완료 요청·블로커 전환 |
| 6 | /dashboard/dash-progress | 전체 진행률 | 일정 대비 진행률, 완료 빈도, 카테고리, 마일스톤 관리 |
| 7 | /dashboard/urgent | 마감 임박 업무 | D-day 그룹, 담당자 필터, 리마인드, 상태·기한·담당자 변경 |
| 8 | /dashboard/workload | 팀원별 업무량 | 업무 분배 차트, 완료율, ML 업무 편중 점수, 업무 배정 |
| 9 | /dashboard/activity | 최근 활동 | 활동 타임라인, 유형·팀원·검색 필터, 활동 분포 |

### 4.1 대시보드 홈

대시보드 홈은 프로젝트 전체 현황을 요약하는 진입 화면이다.

- 전체 업무, 완료율, 블로커, 진행 중 업무 카드
- 프로젝트 기간 기준 누적 완료 진행률 차트
- 마감일이 빠른 미완료 업무 최대 5건
- 팀원별 전체/완료 업무량과 막대 차트
- 최근 활동 최대 5건
- 각 카드 클릭 시 대응 상세 화면으로 이동
- 팀장에게는 업무 추가, 일반 팀원에게는 내 업무 조회 빠른 액션 제공
- 회의록 업로드, 산출물, AI 어시스턴트, 업무 보드 바로가기
- 내 업무 조회 팝업에서 현재 로그인 사용자에게 배정된 업무만 표시
- 내 업무의 상태, 우선순위, 마감일 확인 및 상세 팝업 연결
- 프로젝트 미선택, 로딩, 빈 데이터, API 오류 상태 처리

### 4.2 전체 업무 관리

- 전체·완료·진행 중·블로커 통계
- ID, 업무명, 카테고리, 담당자, 상태, 우선순위, 지연 위험도, 마감일, 출처별 검색
- 전체·대기·진행 중·완료·블로커 상태 필터
- ID, 마감일, 상태, 담당자, 카테고리 정렬
- 체크박스 기반 다중 선택 상태 표시
- 업무 상세 및 댓글 작성
- 상태 변경 시 대상 칸반 컬럼의 마지막 position을 계산해 이동
- 회의록 AI가 생성한 대기 업무 배너와 전용 필터
- 다른 사용자의 변경을 반영하기 위한 15초 간격 조용한 자동 새로고침
- 팀장 전용 업무 추가 버튼
- 완료 업무는 지연 위험도 대상에서 제외
- 예측 이력이 있으나 위험 목록에 없는 미완료 업무는 정상으로 표시

### 4.3 진행률 분석

- 전체 완료율, 완료 업무 수, 목표 완료율, 프로젝트 D-day
- 이번 주 완료 업무 목록
- 팀원별 업무 완료율
- 카테고리별 완료 현황
- 마일스톤 일정 타임라인
- 프로젝트 마감일 및 생성일 기반 일정 시각화
- 지연 위험 업무 중 가장 오래 정체된 업무 계산
- 업무량·전체 업무·전체 진행률 상세 화면 연결
- 진행률 보고서 생성 UI는 현재 미사용 처리

### 4.4 블로커 관리

- 현재 블로커 수, 높은 심각도 수, 위험 업무 평균 지연일
- 지속시간, ID, 심각도, 지연 위험도, 마감일, 담당자, 카테고리 정렬
- 업무별 우선순위, 설명, 담당자, 발생일, 마감일 표시
- 블로커 해결 완료 처리
- 마감일 조정과 댓글 작성
- 팀장 전용 블로커 업무 추가
- 업무별 AI 해결 방법 추천 버튼
- 자동 AI 인사이트 패널은 현재 미사용 처리

### 4.5 진행 중 업무 모니터링

- 진행 중 업무 수
- 3일 이상 업데이트가 없는 업무 수
- ML 주의·위험 단계 업무 수
- 프로젝트 D-day
- 업무별 마지막 업데이트, 현재 상태 체류일, 마감일, 위험 단계 표시
- 팀장은 직접 완료 처리 가능
- 팀원은 본인 담당 업무의 완료 승인을 팀장에게 요청
- 본인 업무 또는 팀장 권한으로 블로커 전환
- 팀장 전용 마감일 조정
- 댓글 작성과 업무 상세 확인
- 업무별 AI 질문 버튼은 현재 미사용 처리

### 4.6 전체 진행률

- 실제 완료율, 마감일이 지난 미완료 업무 수, 프로젝트 D-day
- 프로젝트 시작일·마감일 기반 계획상 예상 진행률 계산
- 누적 완료 업무량 차트
- 날짜별·팀원별 완료 업무량 스택 차트
- 카테고리별 진행률과 지연 위험 비율
- 마일스톤별 완료율, 상태, 일정, 연결 업무 조회
- 팀장 전용 마일스톤 생성·수정·삭제
- 마일스톤 일괄 수정·일괄 삭제
- 일부 요청만 실패해도 성공분을 다시 조회하고 실패 건만 재시도 가능
- 마일스톤 삭제 시 연결 업무는 삭제하지 않고 일정 미정으로 이동
- 진행률 보고서 버튼은 현재 미사용 처리

### 4.7 마감 임박 업무

- 이미 지연, 오늘 마감, 3일 이내, 7일 이내로 그룹화
- 업무명 검색과 담당자 필터
- 15개 단위 점진 표시
- 선택 업무의 담당자, 우선순위, 마감일, 남은 시간, 설명 표시
- 담당자에게 리마인드 알림 전송
- 팀장 전용 담당자 변경과 마감일 조정
- 팀장은 완료 처리, 팀원은 본인 업무 완료 요청
- 본인 담당 업무 또는 팀장 권한으로 블로커 지정
- AI 마감 위험 분석 버튼과 자동 인사이트 패널은 현재 미사용 처리

### 4.8 팀원별 업무량

- 심사자(REVIEWER)를 제외한 프로젝트 구성원 기준 팀원 수 계산
- 진행 중 배정 업무 기준 1인 평균 업무량 계산
- 완료·진행 중·대기·블로커 스택 막대 차트
- 팀원별 완료율 비교
- ML 업무 편중 점수와 이상치 유형 표시
- 과부하 의심 인원과 최고 위험 팀원 표시
- 팀원 카드 클릭 시 해당 팀원의 업무 목록 표시
- 팀장 전용 업무 배정·수정
- 업무 상세 팝업 연결
- 업무·요약·ML 점수 동시 새로고침
- ML 호출 실패 시 과부하 인원을 0명으로 오인하지 않고 오류 문구 표시

### 4.9 최근 활동

- 최근 활동 최대 50건
- 오늘 활동, 최근 7일 활동, 업무 활동, 체크리스트 활동 통계
- 업무 생성, 상태 변경, 담당자 변경, 업무 수정, 업무 삭제, 체크리스트 필터
- 팀원 필터와 활동 메시지 검색
- 활동 유형별 아이콘과 색상
- 행위자, 메시지, 상대 시간 표시
- 팀원별 활동 분포 표시
- AI 분석 보기와 AI 주간 활동 요약은 현재 미사용 처리

## 5. 프론트엔드 공통 모듈

### 5.1 데이터 훅

| 훅 | 역할 |
|---|---|
| useDashboardSummary | 홈 요약, 마감 임박, 팀원별 업무량, 최근 활동 조회 |
| useDashboardTasks | 대시보드 전체 업무 조회 |
| useDashboardProgress | 진행률·마일스톤·카테고리·지연 위험 조회 및 재분석 |
| useDashboardActivities | 최근 활동 최대 50건 조회 |
| useWorkloadScore | FastAPI 기반 업무 편중 점수 조회 |

공통 처리 내용은 다음과 같다.

- projectId가 없으면 데이터와 오류 상태 초기화
- 첫 로드 이후 재조회 시 기존 화면을 유지해 깜빡임 방지
- 요청 generation 번호를 사용해 프로젝트 전환 후 도착한 이전 응답 무시
- refetch가 실제 Promise를 반환하도록 구현해 호출 화면이 완료 시점을 기다릴 수 있음
- 로딩, 오류, 빈 데이터 상태를 화면별로 구분

### 5.2 공통 유틸리티

- 상태와 우선순위 값 정규화
- MM.DD, D-Day, 경과일, 상대 날짜 표시
- 날짜-only 값을 KST 자정으로 해석해 타임존 오차 방지
- 프로젝트 기간 대비 예상 진행률 계산
- 정상·주의·위험 한글/영문 결과 호환 판정
- 상태 변경 시 대상 칸반 컬럼 마지막 position 계산
- 업무 생성 출처를 직접 생성/회의록 AI로 변환
- 사용자 ID 기반 안정적인 프로필 색상 생성
- 활동 유형 정규화, 아이콘·라벨·상대 시간 변환

### 5.3 공통 UI

| 컴포넌트 | 역할 |
|---|---|
| ProgressFrequencyChart | 프로젝트 기간 내 누적 완료 업무량 시각화 |
| TaskDetailPopup | 업무 정보, 출처, 설명, 댓글 조회·작성 |
| TaskStatusPopup | 상태 선택 및 칸반 position 보정 |
| TaskDueDatePopup | 마감일 변경 |
| TaskAssigneePopup | 프로젝트 멤버 조회 및 담당자 변경 |
| MilestoneAddPopup | 마일스톤 생성·수정, 시작일/마감일 검증 |

## 6. Spring Boot 대시보드 API

기본 경로는 /api/v1/projects/{projectId}/dashboard 이다.

| Method | 경로 | 기능 | 현재 명시 권한 |
|---|---|---|---|
| GET | /summary | 메인 요약 집계 | 로그인 |
| GET | /tasks | 대시보드 업무 목록 | 로그인 |
| GET | /activities | 최근 활동 최대 50건 | 로그인 |
| GET | /progress | 진행률·마일스톤·지연 위험 | 로그인 |
| GET | /delay-risk/mine | 로그인 사용자 담당 위험 업무 | 프로젝트 멤버 |
| GET | /workload-score | 업무 편중 라이브 계산 | 프로젝트 멤버 |
| POST | /milestones | 마일스톤 생성 | 팀장 |
| PATCH | /milestones/{milestoneId} | 마일스톤 수정 | 팀장 |
| DELETE | /milestones/{milestoneId} | 마일스톤 삭제 | 팀장 |
| POST | /delay-risk/refresh | 지연 위험도 재분석 | 로그인 |

모든 API는 전역 SecurityConfig에 의해 JWT 로그인이 필요하다. 표의 프로젝트 멤버/팀장 항목은 컨트롤러에 추가로 선언된 메서드 권한이다.

## 7. Spring 집계 로직

### 7.1 메인 요약

- 전체 업무 수: 프로젝트 tasks 전체 건수
- 완료 업무 수: status = done
- 블로커 수: status = blocked
- 진행 중 수: status = inprogress
- 완료율: 완료 수 / 전체 수 × 100 반올림
- 마감 임박: 미완료 업무를 마감일 오름차순으로 정렬해 최대 5건
- 업무량: 담당자별 전체·완료·대기·진행 중·블로커 수
- 최근 활동: 최신순 최대 10건
- 팀원 업무량에서는 REVIEWER 제외
- 담당 업무가 없는 프로젝트 멤버도 0건으로 포함

### 7.2 진행률 상세

- 전체 완료율
- 마일스톤별 연결 업무 수, 완료 수, 완료율
- 마일스톤 상태 자동 계산
  - 연결 업무가 모두 완료되면 done
  - 일부 완료 또는 진행 중 업무가 있으면 inprogress
  - 나머지는 todo
- 카테고리별 전체/완료 업무 수
- 프로젝트 마감일과 생성일
- task + delay_risk 조합의 target_id별 최신 예측 한 건
- 정상 결과는 상세 위험 목록에서 제외
- 예측 이후 삭제된 업무의 고아 예측은 제외

### 7.3 마일스톤

- 생성·수정·삭제 시 프로젝트 멤버 전체에 알림
- 값이 실제로 변경된 경우에만 수정 알림 발송
- 삭제 전 연결 업무의 milestone_id를 null로 변경
- 일괄 수정·삭제는 프론트에서 Promise.allSettled로 부분 실패 처리

### 7.4 성능 개선

현재 로컬 작업에서는 업무·활동·팀원마다 UserRepository.findById를 반복하던 N+1 조회를 제거했다.

- 필요한 assigneeId, actorId, member userId를 먼저 수집
- null 제거 및 중복 제거
- UserRepository.findAllById로 한 번에 조회
- summary, tasks, activities, progress, 내 위험 업무에 공통 적용
- 읽기 API에 @Transactional(readOnly = true) 적용

## 8. ML 지연 위험도

### 8.1 호출 흐름

1. 사용자가 지연 위험 재분석을 요청한다.
2. Spring이 FastAPI의 POST /ai/predict/delay/tasks/predict?project_id={id}를 호출한다.
3. FastAPI가 프로젝트의 미완료 업무를 조회한다.
4. 업무별 피처를 만들고 NORMAL/CAUTION/DANGER 확률을 계산한다.
5. 결과를 정상/주의/위험으로 변환해 ml_predictions에 추가한다.
6. Spring이 target_id별 최신 예측을 다시 조회해 진행률 응답을 반환한다.

FastAPI 호출 실패 시 Spring은 오류를 로그로 남기고 기존 ml_predictions의 마지막 결과로 대시보드를 계속 제공한다.

### 8.2 사용 데이터와 피처

- 업무 상태, 우선순위, 카테고리
- 업무 생성일, 수정일, 실제 마감일
- 연결 마일스톤과 마일스톤 완료율
- 체크리스트 전체/완료 수와 진행 비율
- 업무 댓글 수, 고유 댓글 작성자 수, 마지막 댓글 이후 시간
- 업무 활동 로그 수와 최근 활동량
- 담당자, 현재 상태 체류시간, 경과시간 대비 진행 불균형

Jira 전용 피처 중 현재 서비스 스키마에 없는 링크, worklog, 재오픈 횟수 등은 안전한 기본값으로 근사한다.

### 8.3 모델 운영 안정성

- 모델 아티팩트 미존재 시 503 반환
- Hugging Face 모델 다운로드 및 체크섬 검증 지원
- 노트북 실행 의존성을 제거하고 운영 추론 코드를 delay_model.py로 분리
- 미완료 업무만 예측
- 댓글·활동을 프로젝트 단위로 일괄 조회해 업무별 N+1 방지
- 예측 점수와 클래스별 확률 저장

## 9. ML 업무 편중 점수

### 9.1 호출 흐름

1. 프론트엔드가 GET /dashboard/workload-score를 호출한다.
2. Spring이 FastAPI의 POST /ai/score/workload를 호출한다.
3. FastAPI가 프로젝트의 담당자 배정 업무를 조회한다.
4. 팀원별 피처와 임베딩 난이도 보정을 계산한다.
5. 팀 규모에 따라 이상치 탐지 방식을 선택한다.
6. 계산 결과를 저장하지 않고 라이브 응답으로 반환한다.

Spring FastAPI 클라이언트는 연결 3초, 읽기 30초 타임아웃을 사용하며 실패 시 503과 WORKLOAD_SCORE_UNAVAILABLE을 반환한다.

### 9.2 주요 피처

- 전체 배정 업무 수
- 미완료 업무 수
- 완료율
- 우선순위·카테고리 기반 평균 난이도
- 임베딩 기반 난이도 보정
- 마감 초과 업무 수와 비율
- 3일 이내 마감 업무 수
- 팀 평균 대비 활성 업무, 전체 배정량, 평균 난이도 비율

### 9.3 이상치 탐지

- 팀원 수 15명 미만: MAD 기반 Modified Z-score
- 팀원 수 15명 이상: Isolation Forest
- 0~100 업무 편중 점수 제공
- 과부하 의심: 활성 업무가 팀 평균보다 많고 완료율이 팀 평균보다 낮은 이상치
- 배정량 불균형: 전체 배정량이 팀 평균보다 적고 완료율이 팀 평균보다 높은 이상치
- 그 외 이상치는 이상 패턴(방향 불명확)
- 이상치가 아니면 정상

### 9.4 LangSmith

- 전체 실행을 chain으로 추적
- 피처 생성과 이상치 탐지를 tool로 추적
- 원문 업무 데이터와 임베딩 원문은 기록하지 않음
- 프로젝트 ID, 인원 수, 이상치 수, 최고 점수 등 요약값만 기록
- API 키가 없으면 트레이싱을 비활성화

## 10. 데이터베이스

| 테이블 | 대시보드 사용 내용 |
|---|---|
| projects | 프로젝트 생성일, 마감일 |
| project_members | 팀원 목록과 역할, REVIEWER 제외 |
| users | 담당자·행위자 이름 |
| tasks | 상태, 담당자, 카테고리, 우선순위, 마감일, 완료일, position |
| milestones | 마일스톤 이름, 시작일, 마감일 |
| task_checklists | 지연 위험도 진행 비율 |
| task_comments | 댓글 표시 및 ML 활동 피처 |
| activities | 최근 활동과 ML 활동 피처 |
| ml_predictions | 업무별 지연 위험도 이력 |

주요 마이그레이션은 다음과 같다.

- V20260704_1__activities_message.sql: 활동 메시지와 target 인덱스
- V20260722_1__roadmap_planning_dates.sql: milestones.start_date 및 일정 인덱스
- V20260727_2__task_done_date.sql: 완료 업무 날짜 기록

## 11. 권한과 업무 처리 흐름

### 팀장

- 업무 생성
- 업무 상태 직접 변경 및 완료 처리
- 마감일·담당자 변경
- 업무 배정
- 마일스톤 생성·수정·삭제
- 블로커 해결 처리

### 팀원

- 대시보드 조회
- 내 업무 목록 조회
- 본인 담당 업무의 완료 승인 요청
- 본인 담당 업무의 블로커 전환
- 댓글 작성

### 공통

- 모든 서버 API는 JWT 인증 필요
- 프로젝트 멤버십과 팀장 권한은 Spring @PreAuthorize로 검증
- 프론트엔드 버튼 노출과 서버 권한을 함께 적용
- 업무 생성·수정·상태 변경은 대시보드 전용 API가 아니라 기존 Task API를 재사용

## 12. 오류·로딩·동기화 처리

- 프로젝트 미선택 상태 안내
- 요약·진행률 API 오류 배너
- 첫 로드와 수동 새로고침 상태 분리
- 기존 데이터 유지형 백그라운드 갱신
- 프로젝트 전환 시 stale response 무시
- 마일스톤 부분 실패 시 성공분 먼저 반영
- 지연 위험도 FastAPI 실패 시 마지막 저장 예측 사용
- 업무 편중 FastAPI 실패 시 명시적 오류 표시
- 빈 업무, 빈 활동, 빈 마일스톤, 빈 팀원별 업무량 상태 처리
- KST와 UTC 변환 규칙을 구분해 날짜·상대 시간 오류 방지

## 13. 개발 이력 요약

| 기간 | 주요 내용 |
|---|---|
| 07/16~07/19 | 지연 위험도 학습·모델 비교, 모델 아티팩트와 로더 안정화 |
| 07/20 | Supabase 실제 업무 기반 지연 위험도 API 및 대시보드 연동 |
| 07/21 | Spring/React 지연 위험 DTO, 프로젝트 일정, 날짜 유틸 확장 |
| 07/22 | 대시보드 9개 화면 UI 개편, 인라인 액션, 마일스톤, AI 패널 |
| 07/23 | 활동 타입·위험도 계약 보강, 진행률 차트 공용화 |
| 07/24 | 업무 편중 ML 연동, 알림·권한·정렬·UI 전반 개편 |
| 07/26 | 마일스톤 알림·권한, 편중 로직, 새로고침·색상 안정성 보강 |
| 07/27 | dev 통합 복구, 권한 통일, 마일스톤 부분 실패 회귀 테스트 |

대표 커밋:

- e20e268: 대시보드 Supabase 연동 및 ML 지연 위험도 개선
- 2bb58ed: 대시보드 전체 지연 위험도 적용
- f022866: 대시보드 홈 시안 및 AI 추천 연동
- 25cfe5c: 진행률·블로커·진행 중 화면과 인라인 상태 변경
- 205dace: 전체 진행률·마감 임박·마일스톤
- 05fb9f9: 팀원별 업무량·최근 활동
- 08c51ab: ML 업무 편중 점수 연동
- 53178bd: 대시보드 9개 페이지 대개편
- c76051b: 마일스톤·알림·권한·업무 편중·새로고침 개선
- 21e8827: 마일스톤 부분 실패·로딩 고착 회귀 테스트

## 14. 현재 로컬 미커밋 반영 사항

작성 시점 작업 트리에는 다음 변경이 커밋되지 않은 상태로 존재한다.

- 대시보드 홈의 일반 팀원용 내 업무 조회 팝업 추가
- 자동 AI 추천 액션 컴포넌트의 렌더링과 자동 RAG 호출 비활성화
- 진행률 보고서, AI 마감 분석, AI 활동 분석, 진행 중 업무 AI 질문 UI 비활성화
- 날짜-only 완료일을 KST 자정으로 파싱하도록 보강
- 업무 편중 모델 실패 메시지 보강
- Spring 대시보드 사용자 이름 조회 N+1 제거
- Spring 조회 메서드 readOnly 트랜잭션 적용

현재도 대시보드 빠른 액션의 AI 어시스턴트와 블로커 화면의 직접 AI 해결 방법 추천은 남아 있다. 따라서 최종 정책이 대시보드 AI 기능 전체 비활성화라면 추가 정리가 필요하다.

## 15. 테스트 및 검증 결과

2026-07-27 현재 작업 트리에서 실행한 결과다.

### 프론트엔드

~~~powershell
cd App/frontend
npm.cmd test -- --run src/dashboard src/ai/components/AiInsightBox.test.tsx
~~~

- 테스트 파일 4개 통과
- 테스트 23개 통과
- 실패 0개
- DashProgressPage 테스트 렌더링 중 중복 React key 경고 존재

### Spring Boot

~~~powershell
cd App/backend_spring
.\gradlew.bat test --tests "com.workflowai.dashboard.*"
~~~

- DashboardControllerTest 6개 통과
- DashboardMilestoneSecurityTest 3개 통과
- DashboardServiceTest 9개 통과
- 총 18개 통과

### FastAPI 지연 위험도

~~~powershell
cd App/backend_fastapi
..\..\.venv\Scripts\python.exe -m pytest tests/ml_delay_risk -q
~~~

- 41개 통과
- deprecation warning 14개

### FastAPI 업무 편중 점수

~~~powershell
cd App/backend_fastapi
..\..\.venv\Scripts\python.exe -m pytest tests/ml_workload_score -q --ignore=tests/ml_workload_score/test_workload_router.py
~~~

- 라우터 테스트 제외 47개 통과
- test_workload_router.py는 현재 로컬 가상환경에서 redis.Redis import가 실패해 수집 단계에서 실행되지 못함

## 16. 확인 필요 항목

1. 업무 편중 라벨 계약
   - FastAPI 최신 로직은 저활동 의심 대신 배정량 불균형을 반환한다.
   - Spring DTO와 프론트엔드는 task_count_total_rel을 아직 전달·사용하지 않는다.
   - WorkloadPage의 배지·범례·필터는 아직 저활동 의심을 기준으로 한다.

2. 대시보드 조회 API 권한
   - summary, tasks, activities, progress, delay-risk/refresh는 현재 JWT 로그인만 요구한다.
   - 다른 프로젝트 ID 직접 요청을 막으려면 @projectAccess.isMember 검사가 필요하다.

3. 프론트 버튼과 서버 권한 일치
   - 일부 화면은 모든 사용자에게 상태 변경 버튼을 보여주지만 Task API는 팀장 권한을 요구할 수 있다.
   - 역할별 버튼 노출을 서버 정책과 다시 맞출 필요가 있다.

4. React key 경고
   - DashProgressPage 테스트에서 숫자 tick/차트 요소의 중복 key 경고가 반복된다.
   - 기능 테스트는 통과하지만 렌더링 안정성을 위해 key 생성 규칙을 보강할 필요가 있다.

5. FastAPI 라우터 테스트 환경
   - redis 패키지 import 상태를 복구한 뒤 test_workload_router.py를 포함한 전체 테스트 재실행이 필요하다.

6. AI 기능 노출 정책
   - 자동 인사이트와 일부 버튼은 비활성화했지만 AI 어시스턴트 바로가기와 블로커 AI 버튼은 활성 상태다.
   - 전체 비활성화인지 일부 유지인지 최종 정책 확정이 필요하다.

## 17. 주요 소스 위치

### 프론트엔드

- App/frontend/src/dashboard/screen/DashboardView.tsx
- App/frontend/src/dashboard/screen/detail/
- App/frontend/src/dashboard/components/
- App/frontend/src/dashboard/libs/hooks/
- App/frontend/src/dashboard/libs/types/dashboard.ts
- App/frontend/src/dashboard/libs/utils/

### Spring Boot

- App/backend_spring/src/main/java/com/workflowai/dashboard/controller/DashboardController.java
- App/backend_spring/src/main/java/com/workflowai/dashboard/service/DashboardService.java
- App/backend_spring/src/main/java/com/workflowai/dashboard/service/FastApiDashboardClient.java
- App/backend_spring/src/main/java/com/workflowai/dashboard/service/FastApiWorkloadScoreClient.java
- App/backend_spring/src/main/java/com/workflowai/dashboard/DTO/
- App/backend_spring/src/main/java/com/workflowai/dashboard/entity/
- App/backend_spring/src/main/java/com/workflowai/dashboard/repository/

### FastAPI

- App/backend_fastapi/ml_delay_risk/
- App/backend_fastapi/ml_workload_score/
- App/backend_fastapi/tests/ml_delay_risk/
- App/backend_fastapi/tests/ml_workload_score/

### 데이터베이스

- docs/db/workflow_ai_schema.sql
- App/backend_spring/src/main/resources/db/migration/

## 18. 한 줄 정리

대시보드는 단순 현황판을 넘어 실제 업무·마일스톤·댓글·활동·알림·완료 승인 흐름과 두 종류의 ML 분석을 연결한 프로젝트 운영 화면이며, 현재 기능 구현과 주요 회귀 테스트는 완료됐고 권한 세분화, 업무 편중 응답 계약, React key 경고, FastAPI 라우터 테스트 환경 정리가 남아 있다.
