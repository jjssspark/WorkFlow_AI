# WorkFlow AI

> 팀 프로젝트의 회의, 업무, 개발 기록, 산출물, 평가 근거를 AI가 연결해주는 프로젝트 협업 및 평가 보조 웹 플랫폼

대학생 팀프로젝트, 캡스톤디자인, 해커톤, AI 경진대회, 공모전 팀을 위한 서비스입니다. 회의록 업로드만으로 요약·To-Do·역할 분배를 자동 생성하고, ML/DL/LLM 기술을 기능별로 활용해 기여도와 평가 근거까지 제공합니다.

## 해결하는 문제

- **회의록 정리 부담** — 회의 후 요약, 결정사항, 담당자, 마감일을 다시 정리해야 함
- **역할 분배 불명확** — 누가 무엇을 맡았는지 업무와 회의록이 연결되지 않음
- **일정/진행률 파악 어려움** — 마감일, 지연 작업, 지연 요인을 한눈에 보기 어려움
- **산출물 준비 지연** — 발표자료, 보고서, README가 프로젝트 후반에 급하게 작성됨
- **개발 기록 분리** — GitHub 활동이 업무·보고서·평가 근거와 연결되지 않음
- **기여도 판단 어려움** — 교수/심사자가 팀원별 실제 활동 근거를 확인하기 어려움

## 주요 기능

| 기능 | 설명 | 기술 |
| --- | --- | --- |
| 회의록 AI 분석 | 문서/음성/영상 업로드 → 요약, 결정사항, 위험요소, To-Do 추출 | LLM, Whisper, KoBERT |
| To-Do 자동 생성 | 회의록 기반 업무·담당자 후보 생성, 업무 보드 자동 반영 | LLM, Function Calling |
| 업무 보드 | 카테고리별 칸반, 담당자/마감일/체크리스트 관리 | React, Spring Boot |
| 대시보드 | 진행률, 마감 임박, 업무량, 최근 활동 | Chart UI |
| ML 위험 예측 | 지연 위험도, 업무 편중 점수 산정 | scikit-learn, LightGBM |
| AI Assistant | 프로젝트 데이터 기반 Q&A (출처 포함) | LLM, RAG, Vector DB |
| 산출물 생성 | 발표자료, 보고서, README 초안 생성 | LLM, Template |
| 기여도 리포트 | 업무·회의·GitHub·문서 기반 심사자 전용 평가 근거 | DB Aggregation, LLM |

## 사용자 권한

- **팀장** — 프로젝트 생성, 업무 배정, 회의록 승인, 산출물 검토
- **팀원** — 본인 업무 관리, 회의록 업로드, 산출물 작성
- **심사자** — 진행률·산출물·기여도 리포트 조회, AI 평가 근거 확인, 최종 점수 입력

## 로컬 시연용 테스트 계정

아이디/비밀번호 테스트 로그인은 운영 노출을 막기 위해 기본 비활성화되어 있습니다. 로컬 시연에서만 `.env`에 아래 값을 명시해 켭니다.

```env
WORKFLOW_DEMO_DEV_LOGIN_ENABLED=true
VITE_ENABLE_DEMO_AUTH=true
```

테스트 계정 비밀번호 `1111`은 중간보고/시연 전용이며, 운영 배포 환경에서는 위 값을 켜지 않습니다.

## DB 마이그레이션

기본 앱 실행에서는 Flyway가 비활성화되어 기존 운영 DB에 자동 마이그레이션을 적용하지 않습니다. 배포 DB 스키마는 팀에서 검토한 뒤 아래 둘 중 하나로 반영합니다.

- 권장: `App/backend_spring/src/main/resources/db/init/04_add_password_auth.sql`, `05_add_reviewer_approval_status.sql`, `06_add_project_onboarding_fields.sql`을 운영 DB에 수동 적용
- Flyway 사용 시: 스키마 상태를 먼저 확인한 뒤 `SPRING_FLYWAY_ENABLED=true`를 명시. 기존에 테이블이 있는 DB에서 처음 Flyway를 켜는 경우 `baseline-on-migrate` 기본값은 `true`라서 schema history 부재로 기동이 막히지 않는다. 신규 빈 DB에서 엄격하게 검증하려면 `SPRING_FLYWAY_BASELINE_ON_MIGRATE=false`로 override

`SPRING_FLYWAY_ENABLED` 기본값은 `false`이고, Flyway를 켰을 때의 `SPRING_FLYWAY_BASELINE_ON_MIGRATE` 기본값은 `true`입니다.

## 기술 스택

| 구성 | 기술 |
| --- | --- |
| Frontend | React |
| Backend | Spring Boot (인증/권한/API), AI Backend (FastAPI 추론) |
| AI/ML | LLM, RAG, Whisper(STT), KoBERT/KLUE-BERT, scikit-learn, LightGBM |
| Database | MySQL/PostgreSQL, Vector DB |
| Infra | Redis/Queue (비동기 처리), GitHub API |

## 주요 흐름

1. **회의록 업로드** → AI 분석 → 요약·To-Do 후보 생성 → 업무 보드 반영
2. **업무 관리** → 카테고리 선택 → 상세 정보 입력 → 상태별 칸반 관리
3. **심사자 평가** → 진행률·산출물·GitHub 조회 → 기여도 리포트 확인 → 점수 입력

## 회의록 AI 분석 제공자

회의록 AI 분석 제공자 기본값은 `auto`입니다. `HF_TOKEN`이 있으면 Hugging Face Inference를 먼저 사용하고, 실패하거나 토큰이 없으면 로컬 Ollama, 그 다음 규칙 기반 분석으로 자동 대체합니다.

> **주의(개인정보/기밀)**: `auto` 모드에서 `HF_TOKEN`이 설정된 환경(로컬 `.env`, 배포 서버 등)에 회의록을 업로드하면, 회의록 원문이 Hugging Face의 외부 Inference API로 전송됩니다. 팀원 이름, 업무 내용 등이 포함된 회의록을 외부로 보내고 싶지 않다면 해당 환경에서 `HF_TOKEN`을 설정하지 않거나 `MEETING_ANALYSIS_PROVIDER=ollama`(또는 `rule`)로 명시적으로 고정하세요.

### 로컬 Ollama

- Ollama 설치: https://ollama.com
- 빠른 분석용 모델(기본값): `qwen2.5:1.5b` (로컬에 없으면 `ollama pull qwen2.5:1.5b`)
- 품질 우선 모델: `ollama pull llama3.2:3b` 또는 `ollama pull qwen3:8b` (`MEETING_ANALYSIS_MODEL=모델명`으로 전환)
- FastAPI 직접 실행 시: `OLLAMA_HOST=http://localhost:11434`
- Docker Compose 사용 시: `OLLAMA_HOST=http://host.docker.internal:11434`
- Ollama만 강제로 쓰려면: `MEETING_ANALYSIS_PROVIDER=ollama`
- Ollama를 끄고 기존 규칙 기반 분석만 쓰려면: `MEETING_ANALYSIS_PROVIDER=rule`
- 로컬 모델 응답이 느리면 `MEETING_ANALYSIS_TIMEOUT_SECONDS`, `MEETING_ANALYSIS_MAX_CHARS`, `MEETING_ANALYSIS_NUM_PREDICT` 값을 낮춰 fallback을 더 빨리 태울 수 있습니다.
- 환경변수 변경 후에는 `backend-fastapi`를 재시작해야 반영됩니다.
- 기존에 업로드된 회의록은 새 분석 로직이 소급 적용되지 않으므로 재분석/재업로드가 필요합니다.
- Ollama 서버가 꺼져 있거나 모델이 없거나 응답 파싱에 실패하면 자동으로 기존 규칙 기반 분석으로 대체됩니다.

### Hugging Face Inference

다른 컴퓨터에서 Ollama 설치 없이 시연해야 하면 Hugging Face Inference Provider를 사용할 수 있습니다.

- `.env`에 `HF_TOKEN=발급받은_토큰` 설정
- Hugging Face만 강제로 쓰려면 `.env`에 `MEETING_ANALYSIS_PROVIDER=huggingface` 설정
- 기본 모델: `HF_MEETING_ANALYSIS_MODEL=Qwen/Qwen3-4B-Instruct-2507`
- Docker Compose 사용 시 `backend-fastapi`를 재빌드/재시작해야 반영됩니다.
- Hugging Face 호출 실패 시에는 Ollama, 규칙 기반 분석 순서로 자동 대체됩니다.

## 문서

- [PRD](docs/WorkFlow_AI_PRD.md) — 기능 범위, 요구사항, 권한, AI 적용 범위
- [API 명세서](docs/WorkFlow_AI_API_명세서.md) — REST 경로, 응답 형식, 권한, AI 백엔드 계약
- [기획서 작성 가이드](docs/WorkFlow_AI_기획서_작성가이드.md) — 항목별 작성 가이드
