# 마이그레이션 버전 번호 충돌로 배포가 막히고, preflight가 정상 배포까지 막던 문제

- 날짜: 2026-07-27
- 발견 경로: OCI 서버 정기 점검 (운영 장애는 발생하지 않음)
- 관련: [2026-07-26 Flyway 체크섬 크래시루프](2026-07-26-flyway-checksum-crashloop.md),
  [스키마 변경 경로 일원화 결정](../decisions/2026-07-26-flyway-single-migration-path.md)
- 이 수정을 배포하는 과정에서 별개의 장애가 드러났다:
  [서버 .git root 소유권 문제](2026-07-27-oci-git-root-ownership-blocks-deploy.md)

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

1. `V20260726_1__rag_assignee_sync_failures.sql` 삭제 (main 경로).
   같은 테이블을 만드는 파일이 셋(`V20260709_1`, `V20260724_11`, `V20260726_1`) 있었고,
   `V20260724_11`이 이미 운영에 적용돼 테이블이 실재한다. 셋 다 `CREATE TABLE IF NOT EXISTS`라
   세 번째는 어디서도 아무 일을 하지 않는다. 미적용 파일이므로 삭제해도 장부에 영향이 없다.
2. preflight validate에 `-ignoreMigrationPatterns="*:pending"` 추가.

같은 시각 dev에서는 다른 사람이 **같은 충돌을 삭제가 아니라 개명으로** 풀었다
(`V20260726_1__rag_assignee_sync_failures.sql` → `V20260727_1__...`, 커밋 `a61d603`).
둘 다 중복은 해소되지만 결과가 다르다 — main은 파일이 없고, dev는 새 번호로 남아 다음
배포에 pending 1건으로 적용된다. `CREATE TABLE IF NOT EXISTS`라 운영에는 무해하고 장부에
행 하나가 더 생길 뿐이라 되돌리지 않았다. dev가 main으로 합쳐지면 `V20260727_1`이 최종
상태가 된다.

이 엇갈림 자체가 문제의 성질을 보여준다. **같은 충돌을 두 사람이 서로 모른 채 각자 풀고
있었다.** 아래 후속 조치는 이런 상황을 사람이 눈치채기 전에 CI가 먼저 말하게 하는 것이다.

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

## 후속 조치 — 가드에 중복 검사 추가 (2026-07-27)

이번 충돌은 두 PR이 각각 통과한 뒤 합쳐져서 생겼다. 당시 `migration-guard`는 "이미 적용된
V파일의 수정/삭제"만 막고 버전 번호 중복은 보지 않았다.

검사 자체는 `.github/scripts/check-duplicate-migration-versions.sh` 하나로 두고 **세 곳에서
호출한다.** 중복은 파일 하나만 봐서는 알 수 없고 다른 파일과의 조합에서만 드러나므로,
diff가 아니라 트리 전체를 본다. 버전 정규화는 Flyway 규칙을 그대로 따른다 — `_`는 `.`와
같고, 자릿수 앞의 0은 무시된다(`V1_01` == `V1_1`). 두 규칙 모두 flyway 11.7.2로 실측했다.

| 호출 지점 | 시점 | 성격 |
|---|---|---|
| `migration-guard` (pull_request) | 머지 전 | 유입 차단 |
| `migration-guard` (push: dev, main) | 머지 직후 | 알림 |
| `deploy-oci` 의 `test` 잡 | 배포 직전 | **배포 차단** |

세 번째가 실제 게이트다. `migration-guard`의 push 실행은 **배포를 막지 못한다** —
`deploy-oci`는 별도 워크플로라 병렬로 돌고 서로를 기다리지 않는다. 반면 `deploy` 잡은
`needs: [test, frontend]`로 `test`에 의존하므로, `test` 안에서 검사가 떨어지면 배포 자체가
시작되지 않는다. gradle 테스트보다 앞에 둬서 빨리 떨어지게 했다.

`migration-guard`의 push 실행은 그래서 "어느 브랜치가 언제 깨졌는지"를 즉시 알리는
용도다. PR 시점 검사만으로 부족한 이유는, 두 PR이 같은 번호를 잡았을 때 먼저 열린 PR의
체크가 base가 움직여도 자동으로 다시 돌지 않기 때문이다.

검사 로직은 6개 시나리오로 검증했다 — 현재 트리(통과), 이번 사고 재현(차단),
앞자리 0 변형(차단), 점/밑줄 혼용(차단), 빈 디렉터리(통과), `R__` 반복 실행 파일만(통과).

### 중복이 CI를 다 빠져나가도 운영은 지킨다

세 겹을 다 통과하더라도 `deploy-oci`의 `Preflight Flyway validate`가 컨테이너 교체 전에
막는다. 중복 버전에서 exit 1 이 나는 것은 이번에 운영 DB 대상으로 실측 확인했고(위 표),
preflight 실패 시 `Deploy` 스텝이 skip 되는 것도 실제 배포 실패(run 30229393885)에서
확인했다. 즉 중복 마이그레이션이 운영 Spring 에 도달하는 경로는 없다.

### 여전히 남는 것

가드는 DB를 보지 못하므로 **"이 파일이 이미 적용됐는지"는 판단할 수 없다.** 이번처럼 미적용
파일을 지우는 정당한 경우에도 수정 차단에 걸린다. 그때는 `flyway_schema_history`로 미적용을
확인한 뒤 관리자 권한으로 우회 머지하며, 이 예외 절차를 가드 실패 메시지에도 적어 뒀다.

## 되돌리는 법

| 변경 | 되돌리기 |
|---|---|
| `V20260726_1__rag_assignee_sync_failures.sql` 삭제 | git에서 복원. 단 복원하면 다시 배포 불가가 된다 |
| preflight `-ignoreMigrationPatterns` | `.github/workflows/deploy-oci.yml`에서 해당 줄 삭제. 단 새 마이그레이션 배포가 전부 막힌다 |
