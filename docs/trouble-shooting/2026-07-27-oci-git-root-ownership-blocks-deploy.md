# 서버에서 git을 root로 실행해 이후 배포가 무작위로 실패한 문제

- 날짜: 2026-07-27 (원인 심어진 시점 2026-07-26 09:58)
- 영향: 운영 무중단. 배포 파이프라인만 실패
- 관련: [버전 중복과 preflight pending 오탐](2026-07-27-flyway-duplicate-version-and-pending-preflight.md)

## 증상

main 머지 후 배포가 `Preflight Flyway validate` 스텝에서 실패했다. 그런데 실패 원인이
Flyway가 아니었다.

```
error: insufficient permission for adding an object to repository database .git/objects
fatal: failed to write object
fatal: unpack-objects failed
##[error]Process completed with exit code 128
```

스텝 이름 때문에 스키마 문제로 오해하기 쉽지만, 죽은 것은 그 스텝 안의
`git fetch --quiet origin main` 이다.

## 원인

2026-07-26 09:58, Phase 3 검증 중 서버에서 아직 머지되지 않은 브랜치를 확인하려고
`sudo git fetch` 를 실행했다. `teamlead` 계정은 `/home/ubuntu/work-flow` 에 쓸 수 없어서
sudo를 붙였는데, 이게 저장소에 root 소유 객체를 남겼다.

```
root:root drwxr-xr-x  .git/objects/b1
root:root drwxr-xr-x  .git/objects/11
root:root drwxr-xr-x  .git/refs/remotes/origin/refactor
root:root drwxr-xr-x  .git/logs/refs/remotes/origin/refactor
+ root 소유 파일 27개
```

정상 소유자는 저장소 루트와 같은 `ubuntu:docker` 다.

git은 객체를 **해시 앞 두 자리 이름의 폴더**에 넣는다. root로 fetch하면서 그때 처음
만들어진 폴더(`b1`, `11`)가 `root:root 755` 로 생겼고, 배포 계정 `ubuntu` 는 그 안에
파일을 만들 수 없게 됐다.

## 왜 하루 뒤에 터졌나 — 이 장애의 진짜 성질

`objects/` 최상위는 여전히 `ubuntu:docker 775` 라서, 새 객체가 **다른** 두 자리 폴더로
떨어지면 아무 문제가 없다. 오염된 두 폴더로 떨어질 때만 실패한다.

즉 **배포 성공 여부가 커밋 해시에 달린 확률 문제**가 됐다. 2026-07-26 12:5x 배포는
운 좋게 피해서 성공했고, 그래서 아무도 이상을 눈치채지 못했다. 다음 날 배포가 걸렸다.

원인과 결과 사이에 성공한 배포가 끼어 있으면 사람은 둘을 연결하지 못한다. 이런 잠복성이
이 장애의 가장 위험한 부분이다.

## 조치

```bash
sudo chown -R ubuntu:docker /home/ubuntu/work-flow/.git
```

워킹트리 쪽에는 root 소유 파일이 없어 `.git` 만 되돌리면 됐다. 소유권만 바꾸고 내용은
건드리지 않는다.

검증:

| 확인 | 결과 |
|---|---|
| `find .git -not -user ubuntu \| wc -l` | 31 → **0** |
| `sudo -u ubuntu git fsck` | exit 0 (dangling commit 1개는 중단된 fetch 잔여물, 무해) |
| 배포 재실행 (run 30229393885) | 전 스텝 success |
| Flyway | `Successfully applied 1 migration, now at v20260726.2` |

## 재발 방지

**서버의 `/home/ubuntu/work-flow` 에서 git을 sudo로 실행하지 않는다.** `teamlead` 로 쓰기가
막힌다는 건 그 저장소를 건드리지 말라는 뜻이지, sudo를 쓰라는 뜻이 아니다.

아직 배포되지 않은 커밋의 파일을 서버에서 확인해야 한다면:

- 로컬에서 `scp` 로 `/tmp` 에 넣고 거기서 본다 (이번 preflight 검증도 이 방식으로 했다)
- 또는 저장소가 이미 갖고 있는 ref 에 대해서만 `git archive` 를 쓴다

정기 점검 항목으로 아래를 넣어 두면 잠복 상태를 미리 잡을 수 있다.

```bash
find /home/ubuntu/work-flow/.git -not -user ubuntu | wc -l   # 0 이어야 한다
```

## 남은 이야기 — 게이트가 한 일

이 실패는 `Preflight Flyway validate` 에서 났고, 그 뒤 `Deploy` 스텝은 skip 됐다.
컨테이너가 교체되지 않았으므로 **운영은 옛 버전 그대로 정상 동작했다.** 롤백도 돌지 않았다
(롤백은 deploy/health_check 실패에만 걸리도록 돼 있다).

배포 전 검증을 컨테이너 교체 앞에 둔 설계가 의도대로 동작한 사례다. 실패 지점이 Flyway가
아니라 git이었는데도 결과적으로 안전하게 멈췄다.
