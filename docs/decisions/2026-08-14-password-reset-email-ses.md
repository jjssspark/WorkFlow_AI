# 비밀번호 재설정 메일은 SMTP(Amazon SES)로 보낸다

- 날짜: 2026-08-14
- 대상 브랜치: `fix/nginx-xff-dev-config`
- 상태: **진행 중** — SES 도메인 인증 대기. 남은 작업은 아래 "다음에 할 일" 참고.

## 맥락

비밀번호 재설정은 이미 SMTP 메일 발송으로 구현돼 있었다. 그런데 두 가지 문제가 있었다.

첫째, **운영에서 메일이 한 통도 나가지 않고 있었다.** `.env`에 `WORKFLOW_MAIL_ENABLED=true`가 있어도
`docker-compose.yml`에 `WORKFLOW_MAIL_*` 선언이 없었다. compose가 읽는 `.env`는 compose 파일 안의
`${VAR}` 치환에만 쓰이고 컨테이너 환경으로 자동 주입되지 않는다. 그래서 JVM은 그 값을 볼 수 없었고,
`workflow.mail.enabled`가 기본값 `false`로 떨어져 `MailConfig`가 `LoggingMailSender`를 골랐다.
사용자 화면에는 계정 열거 방지용 고정 문구("메일을 보냈습니다")가 뜨므로 **조용한 실패**였다.

둘째, `.env`의 SES 설정값이 전부 플레이스홀더였다(`email-smtp.<리전>.amazonaws.com` 등).
SES를 쓰려다 중단된 상태였다.

## 검토한 대안과 버린 이유

메일 발송 인프라를 아예 없애는 방향을 먼저 검토했다. 계정 복구는 "그 사람만 가진 무언가"를 증명받는
절차이므로, 이메일을 빼려면 다른 소유 증명으로 대체해야 한다.

| 대안 | 버린 이유 |
|---|---|
| **Google OAuth 본인확인** | 커버리지 구멍. 가입 시 이메일 도메인 제한이 없어(`AuthService.java`의 `EMAIL_PATTERN`은 형식만 검사) `foo@naver.com` 같은 주소로도 가입된다. 그 주소로 Google 계정을 만든 적이 없으면 Google이 아무것도 보증하지 못해 복구가 불가능하다. |
| **관리자 수동 재설정** | 사람이 승인해야 해서 자동으로 동작하지 않는다. 즉시 복구가 안 되고 관리자 계정이 전체 계정의 마스터 키가 된다. |
| **휴대폰 본인확인 / SMS OTP** | 보안은 가장 강하지만 PG사 계약, 건당 비용, 전화번호 수집이 필요하다. `SignupRequest`에 전화번호 필드도 없다. 학교 프로젝트 단계에서 과하다. |
| **TOTP 인증앱 / 복구 코드** | 사용자가 미리 등록·보관해야 한다. 실제로는 아무도 보관하지 않아, 정작 복구가 필요한 시점에 쓸 수 없다. |

Google OAuth를 쓰려면 계정 연결(linking)이 필요한데, 현재 `AuthService.java:84`가
`findByProviderAndProviderId("google", sub)`로만 조회하고 없으면 새 `User`를 만든다.
즉 **로컬 계정과 Google 계정이 연결되지 않는다.** `users` 테이블의 `provider`/`provider_id`가
단일 컬럼(NOT NULL)이라 한 사용자가 한 신원만 가질 수 있다.

## 선택

**기존 SMTP 방식을 유지하고, 발송 인프라로 Amazon SES를 쓴다.**

이유는 커버리지다. 이메일은 가입할 때 반드시 받는 값이라 모든 로컬 계정을 빠짐없이 덮는다.
다른 대안은 전부 일부 사용자를 복구 불가 상태로 남긴다.

- 리전: **아시아 태평양(서울) `ap-northeast-2`**
- 발신 도메인: **`t3-workflow-ai.site`** (운영 도메인과 동일)
- 발신 주소: `no-reply@t3-workflow-ai.site`
- AWS 계정: `199667819366`
- 요금제: Essentials

### 비용

| 항목 | 요금 |
|---|---|
| 아웃바운드 이메일 (월 1천만 통 이하) | $0.16 / 1,000통 |
| 첨부파일 데이터 | $0.12 / GB |
| 월 고정료·구독료 | 없음 |
| 도메인 인증·DKIM·프로덕션 액세스 신청 | 무료 |

재설정 메일만 보내고 첨부파일이 없어 데이터 요금은 0이다. 월 500통이면 $0.08 수준이다.
**Virtual Deliverability Manager(VDM)는 켜지 않는다** — 콘솔이 권하지만 별도 과금 항목이고
재설정 메일에는 필요 없다.

## 지금까지 한 일

### 1. compose 배선 수정 (커밋 대기)

`App/docker-compose.yml`의 `backend-spring.environment`에 `WORKFLOW_MAIL_*` 6개를 선언했다.
기본값은 꺼짐(`application.yml`과 동일) — 자격증명 없이 뜬 환경이 메일을 흘리면 안 되므로
켜는 쪽이 명시적이어야 한다.

로컬에서 Mailpit(SMTP 싱크)을 붙여 끝까지 검증했다.

| 확인 | 결과 |
|---|---|
| MailConfig 선택 | `LoggingMailSender` → `SmtpMailSender` 전환 |
| 메일 수신 | `no-reply@workflow.ai` → `rhantj@naver.com` |
| 링크 | `http://localhost:5173/reset-password?token=...` |
| 그 토큰으로 재설정 | 200 |
| 같은 토큰 재사용 | 400 `INVALID_RESET_TOKEN` (1회용 동작) |
| 새 비밀번호 / 옛 비밀번호 로그인 | 200 / 401 |
| `.env` 없는 환경 기본값 | `WORKFLOW_MAIL_ENABLED=false` |
| 배포 프리플라이트 `config --quiet` | 통과 |

### 2. SES 도메인 자격 증명 생성

- ARN: `arn:aws:ses:ap-northeast-2:199667819366:identity/t3-workflow-ai.site`
- Easy DKIM, RSA_2048
- 상태: **확인 보류 중**

### 3. 가비아 DNS에 레코드 등록

DNS 관리처는 Route 53이 아니라 **가비아**(`ns.gabia.co.kr`)라 자동 게시가 안 돼 수동으로 넣었다.
가비아 네임서버에 직접 조회해 4개 모두 반영을 확인했다.

| 타입 | 호스트 | 값 |
|---|---|---|
| CNAME | `pgswt4fsyfyjnktbl4w7py3rdsw2bsgw._domainkey` | `pgswt4fsyfyjnktbl4w7py3rdsw2bsgw.dkim.amazonses.com.` |
| CNAME | `r2p3kb3ipdumqubbm4wuruyz6rzkyjwq._domainkey` | `r2p3kb3ipdumqubbm4wuruyz6rzkyjwq.dkim.amazonses.com.` |
| CNAME | `ajahql4xy3t5ee7ibs6c7wn4u7kutmxj._domainkey` | `ajahql4xy3t5ee7ibs6c7wn4u7kutmxj.dkim.amazonses.com.` |
| TXT | `@` | `v=spf1 include:amazonses.com ~all` |

기존 A 레코드(`@`, `www` → `161.33.132.66`)는 건드리지 않았다.
가비아는 CNAME 값 끝에 마침표가 없으면 뒤에 도메인을 한 번 더 붙이므로 마침표가 필수다.

## 다음에 할 일

1. **DKIM 인증 완료 확인.** AWS가 DNS를 탐지할 때까지 대기(보통 수십 분, 최대 72시간).
   확인: SES 콘솔 자격 증명 페이지, 또는 `dig +short CNAME <selector>._domainkey.t3-workflow-ai.site`

2. **프로덕션 액세스 신청.** 지금 계정은 샌드박스라 **인증된 주소로만** 발송된다.
   즉 실사용자는 재설정 메일을 받지 못한다. 이게 해제돼야 기능이 실제로 동작한다.
   현재 한도는 일 200통 / 초당 1통. 일 1,000통 정도로 소폭 상향 요청한다(크게 부르면 승인이 어렵다).
   신청서 초안은 아래 "부록" 참고.

3. **SES SMTP 자격증명 발급.** IAM 액세스 키와 다르다. SES 콘솔 > SMTP 설정에서 따로 만든다.
   시크릿이 **한 번만** 표시되므로 발급 즉시 서버 `.env`에 넣어야 한다.

4. **서버 `.env` 채우기.** 현재 전부 플레이스홀더다.
   ```
   WORKFLOW_MAIL_ENABLED=true
   WORKFLOW_MAIL_HOST=email-smtp.ap-northeast-2.amazonaws.com
   WORKFLOW_MAIL_PORT=587
   WORKFLOW_MAIL_USERNAME=<SES SMTP 자격증명 ID>
   WORKFLOW_MAIL_PASSWORD=<SES SMTP 자격증명 시크릿>
   WORKFLOW_MAIL_FROM=no-reply@t3-workflow-ai.site
   ```

5. **바운스·불만 처리 붙이기.** 아직 없다. SES 계정 수준 억제 목록은 기본 활성이지만,
   SNS로 바운스/불만 알림을 받아 처리하는 경로가 없다. 프로덕션 액세스 신청서에
   "will subscribe"라고 적을 예정이므로 실제로 붙여야 한다.

6. **배포.** `deploy-oci.yml`은 `main` push에만 동작한다. dev → main 경로를 거쳐야 반영된다.

## 되돌리는 법

- **compose 배선만 되돌리기**: `App/docker-compose.yml`에서 `WORKFLOW_MAIL_*` 6줄을 지우면
  이전처럼 `LoggingMailSender`로 떨어진다(메일이 로그로만 남는다).
- **SES 자체를 접기**: `.env`에서 `WORKFLOW_MAIL_ENABLED=false`로 두면 코드 변경 없이 발송이 멈춘다.
  SES 자격 증명은 콘솔에서 삭제, 가비아 DNS의 CNAME 3개 + TXT 1개도 삭제한다.
  **A 레코드 2개는 운영 사이트용이므로 절대 지우지 않는다.**
- **다른 발송 업체로 교체**: `WORKFLOW_MAIL_HOST`/`USERNAME`/`PASSWORD`/`FROM`만 바꾸면 된다.
  코드는 표준 SMTP만 쓰므로 SES에 묶인 곳이 없다.

## 부록 — 프로덕션 액세스 신청서 초안

- Mail type: Transactional
- Website URL: `https://t3-workflow-ai.site`

> Work-Flow is a team-project collaboration platform used by university students. It provides
> meeting-minutes management, task assignment, and contribution reporting for student project teams.
>
> We will use Amazon SES for exactly one purpose: transactional password-reset emails. When a user
> who registered with an email address and password clicks "forgot password," we send a single
> message containing a time-limited, single-use reset link that expires in 30 minutes. No other
> email is sent from this account.
>
> Recipients are only addresses that users themselves entered during registration on our site. We do
> not purchase, rent, or import mailing lists, and we send no marketing or promotional email. Because
> every message is triggered by an explicit user action on their own account, there is no subscriber
> list to unsubscribe from.
>
> Expected volume is low: fewer than 100 messages per month, with a peak of roughly 20 per day. We
> are requesting a modest sending limit rather than a high one.
>
> For bounces and complaints, we keep the SES account-level suppression list enabled and will
> subscribe to SES bounce and complaint notifications via Amazon SNS so that problematic addresses
> are removed from future sends. Our reset endpoint is rate-limited per email address and per client
> IP to prevent abuse of the send path.
