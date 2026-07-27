# 마이그레이션 버전 번호 충돌로 배포가 막히고, preflight가 정상 배포까지 막던 문제

- 날짜: 2026-07-27
- 발견 경로: OCI 서버 정기 점검 (운영 장애는 발생하지 않음)
- 관련: [2026-07-26 Flyway 체크섬 크래시루프](2026-07-26-flyway-checksum-crashloop.md),
  [스키마 변경 경로 일원화 결정](../decisions/2026-07-26-flyway-single-migration-path.md)

## 증상

운영은 정상이었다. 컨테이너 7개 전부 가동, 재시작 0회. 다만 두 가지가 겹쳐
**main/dev가 배포 불가 상태**였고, 그 사실이 배포를 시도하기 전까지 드러나지 않았다.

1. 업무 삭제 시 500 — `fk_action_items_created_task` FK 위반. 7/26 23:57 UTC에 4회.
2. 그 수정본(`V20260726_2`)이 코드에는 있는데 운영 장부에는 없었다.

## 왜 배포가 막혀 있었나

### 원인 1 — 같은 버전 번호를 두 사람이 잡았다

| 파일 | 브랜치 | 운영 적용 |
|---|---|---|
| `V20260726_1__admin_reviewer_approval.sql` | yeongju (5f6d8d5) | 적용됨 (rank 16) |
| `V20260726_1__rag_assignee_sync_failures.sql` | jjssspark, PR #350 (1ee8264) | 미적용 |

각 PR은 따로 보면 문제가 없었다. 둘 다 머지되고 나서야 충돌했다.

```
ERROR: Found more than one migration with version 20260726.1
```

Flyway는 이걸 DB에 붙기도 전에, 파일 해석 단계에서 던진다. Spring이라면 기동 실패다.
`V20260726_2`(FK 수정본)는 그 뒤에 줄 서 있었으므로 함께 막혔다 — **7/26 장애의 FK 버그가
고쳐졌는데도 운영에 닿지 못한 이유가 이것이다.**

이번엔 preflight 게이트가 컨테이너 교체 전에 막아서 운영이 무사했다. 게이트가 없었다면
7/26과 똑같은 크래시루프가 났다.

### 원인 2 — preflight가 pending 마이그레이션을 실패로 판정했다

중복 파일을 지우고 다시 돌리니 이번엔 다른 이유로 막혔다.

```
ERROR: Validate failed: Detected resolved migration not applied to database: 20260726.2.
```

Flyway **CLI**의 `validate`는 "아직 적용되지 않은 마이그레이션"도 실패로 친다. 반면
**Spring**은 `migrate()` 안에서 검증하므로 pending을 정상으로 본다 — 곧 적용할 것이기 때문이다.
즉 preflight와 런타임의 판정 기준이 서로 달랐다.

결과적으로 **새 V파일을 들고 오는 배포는 전부 preflight에서 막히는 상태**였다. 7/26 배포가
통과했던 건 그 시점에 pending이 하나도 없었기 때문이고, 우연이었다.

## 조치

1. `V20260726_1__rag_assignee_sync_failures.sql` 삭제.
   같은 테이블을 만드는 파일이 셋(`V20260709_1`, `V20260724_11`, `V20260726_1`) 있었고,
   `V20260724_11`이 이미 운영에 적용돼 테이블이 실재한다. 셋 다 `CREATE TABLE IF NOT EXISTS`라
   세 번째는 어디서도 아무 일을 하지 않는다. 미적용 파일이므로 삭제해도 장부에 영향이 없다.
2. preflight validate에 `-ignoreMigrationPatterns="*:pending"` 추가.

## 완화 범위 검증 (운영 DB 실측, 읽기 전용)

`*:pending`이 게이트를 무력화하지 않는지 세 시나리오로 확인했다.

| 시나리오 | 기대 | 실측 |
|---|---|---|
| 중복 제거본 | 통과 | `Successfully validated 32 migrations`, exit 0 |
| 버전 중복 재현 | 차단 | `Found more than one migration with version 20260726.1`, exit 1 |
| 체크섬 변조 | 차단 | `checksum mismatch for 20260724.4` (587121989 vs -2088185528), exit 1 |

pending만 완화되고 체크섬·중복 탐지는 그대로다.

## 부수 관찰

Supabase 트랜잭션 풀러(6543)에 붙으면 validate 실패 시 `prepared statement "S_1" already exists`
스택트레이스가 진짜 원인 메시지 앞에 섞여 나온다. 종료 코드와 판정은 정상이므로 무시해도 되지만,
로그를 읽을 때 **맨 아래 `ERROR: Validate failed:` 줄부터 보는 것이 맞다.**

## 남은 위험

이번 충돌은 두 PR이 각각 통과한 뒤 합쳐져서 생겼다. `migration-guard`는 지금 "이미 적용된
V파일의 수정/삭제"만 막고 **버전 번호 중복은 보지 않는다.** 같은 날 두 사람이 작업하면 그대로
재발한다. 가드에 중복 검사를 추가하는 것이 근본 대책이다.

## 되돌리는 법

| 변경 | 되돌리기 |
|---|---|
| `V20260726_1__rag_assignee_sync_failures.sql` 삭제 | git에서 복원. 단 복원하면 다시 배포 불가가 된다 |
| preflight `-ignoreMigrationPatterns` | `.github/workflows/deploy-oci.yml`에서 해당 줄 삭제. 단 새 마이그레이션 배포가 전부 막힌다 |
