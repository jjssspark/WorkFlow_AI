# 비밀번호 상한은 글자 수가 아니라 UTF-8 72바이트로 센다

- 날짜: 2026-08-15
- 대상 브랜치: `feature/password-change` (PR #605 → `dev`)
- 상태: **적용 완료**

## 맥락

`BCryptPasswordEncoder.encode()`는 UTF-8 72바이트를 넘는 입력을 **자르지 않고**
`IllegalArgumentException("password cannot be more than 72 bytes")`를 던진다. 실측으로 확인했다.

```
[PROBE] korean25 bytes=75
[PROBE] encode(korean25) THREW IllegalArgumentException: password cannot be more than 72 bytes
```

그런데 비밀번호 정책은 글자 수로만 세고 있었고, 그나마 값이 서로 어긋나 있었다.

| 경로 | 변경 전 상한 | 결과 |
|---|---|---|
| 가입 (`AuthService.signup`) | **없음** | 73바이트 이상이면 500 |
| 재설정 (`PasswordResetService.confirmReset`) | 128자 | 한글 25자(75바이트)가 통과 → 500 |
| 변경 (`AuthService.changePassword`) | 72바이트 | 정상 |

한글은 UTF-8 3바이트라 **25자만 되어도** 걸린다. 사용자에게는 입력 오류가 아니라 서버 장애로 보였다.

재설정은 더 나빴다. 검증 통과 → `consumeIfUnused`(토큰 소모) → `encode()` 순서라, 500이 나는 시점엔
이미 재설정 링크가 소모된 뒤였다. 사용자는 메일을 다시 받아야 했다. 해당 검증 블록의 주석은
"정책 위반은 토큰을 소모하기 전에 막는다"고 선언하고 있었는데, 그 약속이 바이트 위반에서만 깨져 있었다.

## 선택

**최소 8자 / 최대 UTF-8 72바이트**를 `PasswordPolicy` 한 곳에 두고 가입·변경·재설정 세 곳에서 부른다.
상수가 클래스마다 흩어져 72와 128로 어긋난 것이 이번 결함의 직접 원인이라, 규칙을 한 곳으로 모았다.

글자 수 상한을 **함께 두지 않는다.** 두 기준이 공존하면 129자를 넣은 사용자에게 "128자 이하"라고
안내했다가, 100자로 줄여 오면 그제서야 "72바이트"라고 말하게 된다. 기준은 하나여야 한다.

DTO(`@Size`)의 글자 수 상한은 bcrypt에 임의 크기 입력이 도달하지 않게 막는 페이로드 방어선으로만
남기고, 문구가 바이트 기준 안내와 어긋나지 않게 72자로 맞췄다. 실제 바이트 상한은 `PasswordPolicy`가
지킨다 — 한글 25자는 `@Size`(25자)를 통과해 `PasswordPolicy`(75바이트)에서 걸린다.

`@Size`는 min과 max에 메시지를 하나만 쓰므로 방향별로 나눠 단다. 하나로 묶으면 8자 미만 입력에도
"너무 깁니다"라는 정반대 안내가 나간다.

### 로그인은 상한을 낮추지 않는다

`LoginRequest`는 128자를 유지한다. `matches()`에는 72바이트 검사가 **없고**, 초과 입력에 예외 대신
`false`를 돌려준다. 게다가 `checkpw`는 72바이트에서 **잘라서** 비교한다.

```
[PROBE] matches(korean25) returned false
[PROBE] matches(korean25, hash-of-korean24) = true   ← 자른다
```

따라서 로그인 쪽에 "72바이트 초과 = 오답" 방어를 넣으면 500을 막는 게 아니라, 자르던 시절 인코더로
만들어진 해시를 쓰는 계정이 자기 진짜 비밀번호로 로그인하지 못하게 만들 뿐이다. 넣지 않는다.

## 계약 변경 영향

API 상한이 128자에서 72바이트로 **축소**된다. 파괴적 변경으로 보이지만, 잃는 기능은 없다.

- 73바이트~128자 구간은 원래도 성공한 적이 없다. `encode()`가 항상 예외를 던졌으므로 그런 비밀번호로
  만들어진 계정도, 완료된 재설정도 존재할 수 없다. 바뀐 것은 **500 크래시가 400 + 안내가 된 것**이다.
- 사용자 대상 문서 중 128자를 약속한 곳은 없다(확인함. 검색에 걸린 128은 Redis 비밀번호 설정뿐).
- 클라이언트는 `App/frontend` 하나다. FastAPI 백엔드는 비밀번호를 다루지 않는다. 프론트도 같은 규칙
  (바이트 기준)으로 맞췄다.
- 자르던 시절 해시를 쓰는 계정이 혹시 있더라도 **로그인은 영향받지 않는다.** 위 결정대로
  `LoginRequest`를 건드리지 않았기 때문이다. 이번 변경은 비밀번호를 새로 설정하는 경로에만 걸린다.

## 버린 대안

- **글자 수 상한을 유지하고 bcrypt 예외를 잡아 400으로 바꾸기** — 예외를 사후에 번역하는 방식이라
  안내 문구가 여전히 실제 한계와 어긋난다. 사용자는 "128자 이하"를 지켰는데 거절당한다.
- **비밀번호를 미리 SHA-256으로 줄여 bcrypt에 넘기기** — 72바이트 제약이 사라지지만 저장된 해시 형식이
  바뀌어 기존 계정 전체의 마이그레이션이 필요하다. 얻는 것에 비해 비용이 크다.
- **현재 비밀번호(`currentPassword`)에도 바이트 검사 추가** — `matches()`가 던지지 않으므로 불필요하고,
  위 "로그인" 항목과 같은 이유로 오히려 위험하다. 전제가 깨지는 순간은
  `AuthServiceChangePasswordTest.changePassword_currentPasswordOver72Bytes_...`가 잡는다.

## 되돌리는 법

`PasswordPolicy.MAX_BYTES`를 바꾸면 세 경로가 함께 움직인다. 정책 자체를 되돌리려면
`PasswordPolicy.validateNewPassword` 호출부 세 곳(`AuthService.signup`, `AuthService.changePassword`,
`PasswordResetService.confirmReset`)을 각자 검증으로 되돌리고, `SignupRequest`·`PasswordResetConfirmDto`·
`PasswordChangeRequest`의 `@Size`와 프론트
(`PasswordChangeSection.tsx`, `PasswordResetConfirmScreen.tsx`)의 `MAX_PASSWORD_BYTES`를 함께 맞춰야 한다.

단, **72바이트보다 큰 값으로는 올릴 수 없다.** bcrypt 자체의 한계라서, 올리면 500이 다시 돌아온다.
정말 더 긴 비밀번호를 받아야 한다면 위 "버린 대안"의 사전 해싱 방식과 기존 해시 마이그레이션이 필요하다.
