# duckdns 도메인 폐기와 남아 있던 인증서 정리

- 날짜: 2026-07-27
- 발견 경로: 배포 후 정기 점검 (운영 장애는 발생하지 않음)
- 선행 기록: `document_허영주/2026-07-20-oci-cert-deploy-troubleshooting.md` (도메인 이전 당시)

## 증상

배포 검증 중 `https://t3-workflow-ai.duckdns.org/`가 열리지 않았다. 서버가 죽은 게
아니라 TLS 단계에서 끊긴다.

```
subject: CN=t3-workflow-ai.site
subjectAltName does not match host name t3-workflow-ai.duckdns.org
SSL: no alternative certificate subject name matches
```

HTTP(80)는 301로 정상 응답한다. 마지막 HTTPS 단계에서만 막힌다.

## 왜 이렇게 되나 — nginx는 도메인을 모른다

운영 nginx 설정은 이렇다.

```nginx
server {
    listen 443 ssl;
    server_name _;
    ssl_certificate     /etc/letsencrypt/live/current/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/current/privkey.pem;
}
```

`server_name _` 캐치올에 인증서 경로도 `current`라는 심볼릭 링크 하나다. 도메인이
바뀌어도 링크만 다시 걸면 되도록 일부러 이렇게 만든 구조다(`scripts/init-letsencrypt.sh`
가 링크를 생성한다).

대신 **어떤 주소로 들어오든 서버는 인증서 하나만 내민다.** 지금 `current`는
`t3-workflow-ai.site`를 가리키므로, duckdns로 접속하면 이름이 안 맞아 브라우저가 끊는다.
duckdns 인증서가 서버에 남아 있어도 nginx가 그것을 제시하는 경로 자체가 없다.

## 정리 전 상태

갱신 설정이 셋이었다.

| 갱신 설정 | 인증서 실체 | nginx 사용 | 상태 |
|---|---|---|---|
| `t3-workflow-ai.site.conf` | 있음 (2026-10-18 만료) | 사용 중 | 정상 |
| `t3-workflow-ai.duckdns.org-0001.conf` | 있음 (유효) | 안 씀 | 갱신은 되지만 무의미 |
| `t3-workflow-ai.duckdns.org.conf` | **없음** | 안 씀 | 매 주기 파싱 실패 |

세 번째가 문제였다. 7/20 도메인 이전 때 `live/t3-workflow-ai.duckdns.org/` 디렉터리는
사라졌는데 갱신 설정만 남아, certbot이 돌 때마다 같은 메시지를 뱉고 있었다.

```
Renewal configuration file /etc/letsencrypt/renewal/t3-workflow-ai.duckdns.org.conf is broken.
The error was: expected /etc/letsencrypt/live/t3-workflow-ai.duckdns.org/cert.pem to be a symlink
Skipping.
0 renew failure(s), 1 parse failure(s)
```

**이것 자체는 서비스에 무해하다.** 실질 피해는 로그다. 이 메시지가 certbot 로그를 계속
덮어써서, 진짜 갱신 실패가 생겨도 같은 화면 속에 묻힌다. `.site` 인증서는 10/18 만료라
9월에 갱신이 돌아야 하는데 그때 실패해도 알아채기 어려운 상태였다.

## 조치

운영 도메인은 `t3-workflow-ai.site` 하나로 확정하고, duckdns 흔적을 서버에서 제거했다.

```bash
# 되돌릴 수 있게 먼저 보관
docker exec workflow-certbot sh -c '
  mkdir -p /etc/letsencrypt/backup-duckdns-20260727
  cp -a /etc/letsencrypt/renewal/t3-workflow-ai.duckdns.org*.conf     /etc/letsencrypt/backup-duckdns-20260727/
  cp -a /etc/letsencrypt/archive/t3-workflow-ai.duckdns.org-0001      /etc/letsencrypt/backup-duckdns-20260727/archive-0001
'

docker exec workflow-certbot certbot delete --cert-name t3-workflow-ai.duckdns.org-0001 --non-interactive
docker exec workflow-certbot certbot delete --cert-name t3-workflow-ai.duckdns.org      --non-interactive
```

깨진 쪽도 `certbot delete`가 그대로 처리했다. 파일을 직접 지울 필요는 없었다.

## 검증

| 확인 | 결과 |
|---|---|
| `renewal/` | `t3-workflow-ai.site.conf` 하나만 남음 |
| `live/` | `t3-workflow-ai.site` + `current` |
| `current` 링크 | `→ /etc/letsencrypt/live/t3-workflow-ai.site` (변동 없음) |
| `https://t3-workflow-ai.site/` | 200 |
| `https://t3-workflow-ai.site/api/v1/health/ready` | 200 |
| 제시 인증서 | `CN=t3-workflow-ai.site`, 2026-10-18 만료 |
| `certbot renew --dry-run` | 파싱 실패 0건, `all simulated renewals succeeded` |

`current`가 가리키는 대상을 건드리지 않았으므로 nginx 재시작도 필요 없었다.

dry-run 로그에 `t3-workflow-ai.site.conf` 하나만 처리된다고 찍히고 `broken` 메시지는
사라졌다. 즉 9월 갱신이 실패하면 이제는 로그에서 바로 보인다.

```
Processing /etc/letsencrypt/renewal/t3-workflow-ai.site.conf
Certificate not due for renewal, but simulating renewal for dry run
Congratulations, all simulated renewals succeeded:
  /etc/letsencrypt/live/t3-workflow-ai.site/fullchain.pem (success)
no renewal failures
```

참고로 `certbot renew`는 비대화형 실행에 **최대 8분의 무작위 지연**을 넣는다
(`Non-interactive renewal: random delay of 479s`). dry-run이 몇 분씩 응답이 없어도
멈춘 게 아니다.

## 남은 것 — DNS 레코드는 아직 살아 있다

`t3-workflow-ai.duckdns.org`는 여전히 `161.33.132.66`으로 해석된다. 이건 서버가 아니라
duckdns.org 계정에서 지워야 한다. 안 지워도 동작상 문제는 없다 — 그 주소로 오는 요청은
HTTPS 단계에서 브라우저가 막는다.

다만 HTTP로 들어오면 리다이렉트가 `$host`를 그대로 쓴다.

```nginx
location / { return 301 https://$host$request_uri; }
```

옛 주소로 들어온 사람은 duckdns HTTPS로 넘어가 인증서 경고를 만난다. `.site`로
흘려보내고 싶으면 `$host` 대신 도메인을 고정해야 하는데, 그러면 nginx 설정이 도메인을
알게 되어 위에서 설명한 "도메인 몰라도 되는 구조"가 깨진다. duckdns 레코드를 지우는
쪽이 더 깔끔하다.

## 되돌리는 법

| 변경 | 되돌리기 |
|---|---|
| duckdns 인증서 삭제 | `/etc/letsencrypt/backup-duckdns-20260727/`에 원본 보관. 다만 복원보다 재발급이 빠르다 — `DOMAIN=<도메인> EMAIL=<이메일> bash scripts/init-letsencrypt.sh` |
| 런북 도메인 안내 | git에서 `App/DEPLOY_OCI.md` 복원 |
