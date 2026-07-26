# OCI 배포 런북

대상 서버: `workflow-ai-oci` (161.33.132.66, Ubuntu 24.04 ARM, 2 OCPU / 12GB)

설계 배경과 결정 근거는 [배포 설계 문서](../docs/superpowers/specs/2026-07-17-oci-deployment-design.md) 참고.

이번 배포에서 **Ollama(로컬 LLM)는 제외**한다. RAG 검색/생성은 동작하지 않고,
회의 분석은 Spring의 `FallbackMeetingAnalyzer`가 대신 처리한다. 앱은 정상 동작한다.

---

## 1. 도메인 준비

구글 OAuth는 리디렉션 URI에 **HTTPS와 실제 도메인을 강제**한다. 생 IP(`161.33.132.66`)는
HTTP라서 한 번, IP라서 또 한 번 거부되므로 도메인이 반드시 필요하다.

[DuckDNS](https://www.duckdns.org) 등에서 무료 서브도메인을 받아 `161.33.132.66`에 연결한다.

연결됐는지 확인:

```bash
dig +short <도메인>     # 161.33.132.66 이 나와야 함
```

## 2. OCI Security List에 80/443 열기

콘솔 → 인스턴스 → 가상 클라우드 네트워크(`workflow-vcn`) → 서브넷 → 보안 목록 →
수신 규칙 추가. 기본은 22만 열려 있다.

| 소스 CIDR | 프로토콜 | 대상 포트 |
|---|---|---|
| 0.0.0.0/0 | TCP | 80 |
| 0.0.0.0/0 | TCP | 443 |

## 3. 서버 iptables 열기

**OCI Ubuntu 이미지는 22를 제외한 모든 포트를 iptables로 차단한다.** 위 2번만 하고
여기서 막히는 게 OCI의 대표적 함정이다.

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save     # 재부팅 후에도 유지
```

> Docker가 publish한 포트는 nat/FORWARD 체인으로 처리돼 **INPUT 규칙을 우회한다.**
> 그래서 위 규칙은 nginx 노출용일 뿐, DB 보호 수단이 아니다. DB·Redis·Kafka는
> `docker-compose.prod.yml`이 외부 게시를 제거하거나 `127.0.0.1`에만 바인딩해서 막는다.

## 4. Docker 설치

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker $USER && newgrp docker
```

`docker compose version`이 **v2.24 이상**이어야 한다. `docker-compose.prod.yml`이
쓰는 `!override` 태그가 그 버전부터 지원된다.

## 5. 코드 내려받기 + .env 작성

```bash
git clone https://github.com/rhantj/work-flow.git
cd work-flow/App
cp .env.example .env
```

`.env`에서 반드시 바꿀 값:

```bash
POSTGRES_PASSWORD=<길고 무작위한 값>          # 기본값 root 절대 금지
JWT_SECRET=<32바이트 이상 무작위 문자열>
REDIS_ADMIN_PASSWORD=<32~128자 영숫자·밑줄·하이픈>
REDIS_SPRING_PASSWORD=<위와 다른 32~128자 값>
REDIS_FASTAPI_PASSWORD=<위 두 값과 다른 32~128자 값>
GOOGLE_CLIENT_ID=<구글 콘솔 값>
GOOGLE_CLIENT_SECRET=<구글 콘솔 값>
GOOGLE_REDIRECT_URI=https://<도메인>/api/v1/auth/google/callback
WORKFLOW_FRONTEND_BASE_URL=https://<도메인>
WORKFLOW_CORS_ORIGINS=https://<도메인>
```

무작위 값 생성:

```bash
openssl rand -base64 36
```

Redis ACL 비밀번호는 특수문자 제한이 있으므로 각각 `openssl rand -hex 32`로 생성한다.
세 값 중 하나라도 비어 있으면 운영 Compose와 배포 workflow가 즉시 실패한다.
workflow는 서비스 변경 전에 세 값의 길이·허용 문자·상호 중복을 검사한다. 이 검사를 통과하지
못하면 기존 컨테이너는 건드리지 않는다.

### Redis Stream 최초 전환 주의

이 릴리스는 기존 버전이 처리할 수 없는 Redis Stream과 세 개의 Redis ACL 비밀번호를 도입하는
파괴적 전환이다. 고정 `container_name` 단일 Compose 배포이므로 무중단 배포가 아니다. 최초
전환은 maintenance window에서 수행하고 OCI `.env`에 서로 다른 Redis 비밀번호 세 개를 먼저
프로비저닝한다. 이전 버전으로 되돌릴 수 있는 조건은 `XLEN=0`, `XPENDING=0`뿐이다.

Spring liveness는 `/api/v1/health/live`, Redis·Worker를 포함한 readiness는
`/api/v1/health/ready`다. 트래픽 및 배포 판정에는 readiness를 사용한다.

### 이전에 노출된 자격 증명 회전

이 저장소나 CI 로그, 채팅, 보고서에 한 번이라도 값이 노출됐던 자격 증명은 배포 전에
**모두 폐기하고 새 값으로 회전해야 한다.** 기존 값을 재사용하거나 이 문서에 실제 값을 기록하지 않는다.

- Hugging Face: `HF_TOKEN`, `HUGGINGFACEHUB_API_TOKEN`
- LangSmith: `LANGSMITH_API_KEY`
- Google OAuth: `GOOGLE_CLIENT_SECRET`
- 내부 API: `RAG_INTERNAL_API_KEY`
- DB: `POSTGRES_PASSWORD`, `SPRING_DATASOURCE_PASSWORD`, `DATABASE_URL`에 포함된 비밀번호
- 애플리케이션 서명: `JWT_SECRET`
- Redis ACL: `REDIS_ADMIN_PASSWORD`, `REDIS_SPRING_PASSWORD`, `REDIS_FASTAPI_PASSWORD`

각 공급자 콘솔에서 기존 토큰을 먼저 revoke한 뒤 OCI의 `.env`만 갱신한다. `.env`의 값,
토큰 일부, 해시를 터미널 출력이나 작업 기록에 붙여 넣지 않는다.

## 6. 구글 콘솔에 리디렉션 URI 등록

[Google Cloud Console](https://console.cloud.google.com/apis/credentials) → OAuth 2.0 클라이언트 ID →
**승인된 리디렉션 URI**에 아래를 추가한다. `.env`의 `GOOGLE_REDIRECT_URI`와 한 글자도 다르면 안 된다.

```
https://<도메인>/api/v1/auth/google/callback
```

## 7. 인증서 발급 + 기동

```bash
cd work-flow/App
DOMAIN=<도메인> EMAIL=<이메일> bash scripts/init-letsencrypt.sh
```

처음이라면 `STAGING=1`을 붙여 시험 발급을 먼저 해보는 걸 권한다. Let's Encrypt는
운영 환경에서 **주당 5회 실패 제한**이 있어서, 설정이 틀린 채로 반복하면 일주일간 막힌다.

```bash
STAGING=1 DOMAIN=<도메인> EMAIL=<이메일> bash scripts/init-letsencrypt.sh
```

성공하면 `sudo rm -rf /etc/letsencrypt/live/<도메인>` 후 `STAGING` 없이 다시 실행한다.

이후 배포는 아래 한 줄이다:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

첫 빌드는 2 OCPU에서 **10~20분** 걸린다 (Gradle + pnpm + pip).

## 8. 스키마 마이그레이션

Flyway가 전담한다. 별도 수동 적용 절차는 없다. 운영 서버는 `.env`에
`SPRING_FLYWAY_ENABLED=true`가 있어야 하며, 배포 시 `Preflight Flyway validate` 스텝이
컨테이너 교체 전에 장부 정합성을 확인한다. 실패하면 배포가 중단되고 실행 중인 서비스는
그대로 유지된다.

새 스키마 변경은 `App/backend_spring/src/main/resources/db/migration/`에
`V<날짜>_<순번>__<설명>.sql` 형식으로 **새 파일을 추가**한다. 이미 적용된 파일은 절대
수정하지 않는다(`migration-guard` CI가 차단한다).

이력 확인:

```bash
docker logs workflow-backend-spring 2>&1 | grep -i flyway
```

> `V20260701_1`~`V20260713_1`은 구 `docs/db/migrations/001~013`을 이관한 것이다. 운영
> baseline(`20260721.1`)보다 번호가 낮아 `Below Baseline`으로 무시된다 — 운영에는 이미
> 전부 적용돼 있으므로 의도된 동작이다. 빈 DB로 새로 구축할 때는 이 14개가 실행되지 않으므로
> **같은 내용을 `db/init/11_pre_baseline_backfill.sql`이 담는다**(생성물). pgvector 확장,
> `document_chunks.embedding` → `vector(1024)` 전환, `rag_assignee_sync_failures`가 여기서
> 만들어진다. 새 V파일을 baseline 아래에 추가하는 일은 없어야 하므로 이 백필 파일도 갱신할
> 일이 없다 — OCI 이관 시 baseline 재설계와 함께 폐기한다.

### 빈 DB 구축 시 운영과 남는 차이 (2026-07-26 실측)

`db/init` + Flyway로 빈 DB를 만들어 운영 Supabase와 객체 단위로 비교한 결과다. 아래는 모두
이 문서의 변경과 무관한 **기존 divergence**이며, `docs/db/workflow_ai_schema.sql`(2026-07-22
Supabase 덤프)에만 정의돼 있거나 어디에도 정의가 없다.

| 차이 | 내용 | 영향 |
|---|---|---|
| `workload_scores` 테이블 일체 | 테이블·컬럼 5·FK 2·PK | FastAPI가 테이블 없음을 정상 처리한다(`load_workload_scores` 테스트로 보장) |
| 성능 인덱스 6개 | `idx_tasks_project_id`, `idx_comments_target` 등 | 기능 영향 없음, 대용량에서 성능 차 |
| `uq_action_items_created_task` | 유니크 제약 | 신규 환경에 중복 방지 없음 — 보강 필요 |
| 매핑되지 않는 컬럼 5개 | `users.is_admin`·`faculty_id`·`reviewer_rejection_reason`, `tasks.done_date`, `evaluation_scores.total_score` | JPA 엔티티가 쓰지 않음. 운영에만 남은 잔재 |
| FK 이름 6개 | 운영은 `*_fkey` 자동 이름, 신규는 `fk_*` 명시 이름 | 같은 테이블·컬럼에 존재해 무결성 동등 |
| varchar 길이 10개 | 운영은 길이 무제한, 신규는 제한 있음 | 운영이 더 느슨한 쪽. 기동 검증에 영향 없음 |

`evaluation_scores.total_score`는 머지되지 않은 `origin/contribution_score` 브랜치의 V파일에
있다 — 2026-07-26 장애와 같은 경로(머지 안 된 브랜치가 운영 스키마를 바꿈)다.

### 임베딩 차원 전환 이력 (참고)

`db/init`은 `document_chunks.embedding`을 JSONB로 만들고, `V20260701_1`이 `VECTOR(768)`로,
`V20260707_2`가 `VECTOR(1024)`로 바꿨다(RAG 임베딩 모델이 Ollama/nomic-embed-text 768차원에서
Hugging Face/BAAI/bge-m3 1024차원으로 전환됨에 따른 변경).

`V20260707_2`는 컬럼 타입만 바꾸고 기존 임베딩 값은 NULL로 비운다(차원이 달라 기존 벡터를
옮길 수 없음). **운영에서는 2026-07 최초 적용 시 재임베딩을 이미 완료했다.** 빈 DB로 새로
구축한 경우에만 아래를 1회 실행한다.

```bash
cd work-flow/App/backend_fastapi
python -m llm_rag_assistant.scripts.reembed_document_chunks
```

## 9. 검증

```bash
curl -I  https://<도메인>/                      # 200, 인증서 유효
curl -fsS https://<도메인>/api/v1/health/ready  # 200

# 아래는 전부 실패(404)해야 정상 — prod 프로필이 걸렸다는 뜻
curl -o /dev/null -w '%{http_code}\n' https://<도메인>/api/v1/auth/dev-login/1
curl -o /dev/null -w '%{http_code}\n' https://<도메인>/swagger-ui/index.html

# 외부에서 내부 포트가 안 보여야 정상 (모두 타임아웃/거부)
for port in 5432 6379 9092 8000 8080; do
  nc -zvw3 <도메인> "$port" && echo "UNEXPECTED OPEN: $port" && exit 1
done
```

브라우저에서 구글 로그인 → 보드 진입까지 확인한다.

### Redis AOF·ACL·queue readiness

OCI의 `App` 디렉터리에서 실행한다. 실제 비밀번호를 출력하지 않으며 `set -x`를 사용하지 않는다.

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml config --quiet
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T redis \
  sh -c 'REDISCLI_AUTH="$REDIS_ADMIN_PASSWORD" redis-cli --raw --user admin ping'
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T redis \
  sh -c 'REDISCLI_AUTH="$REDIS_ADMIN_PASSWORD" redis-cli --raw --user admin CONFIG GET appendonly appendfsync maxmemory maxmemory-policy auto-aof-rewrite-percentage auto-aof-rewrite-min-size'
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T redis \
  sh -c 'REDISCLI_AUTH="$REDIS_ADMIN_PASSWORD" redis-cli --raw --user admin XINFO GROUPS meeting-analysis' \
  | grep -qx meeting-analysis-workers
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T redis sh -ec '
  spring() { REDISCLI_AUTH="$REDIS_SPRING_PASSWORD" redis-cli --raw --user spring "$@"; }
  fastapi() { REDISCLI_AUTH="$REDIS_FASTAPI_PASSWORD" redis-cli --raw --user fastapi "$@"; }
  default_denied=$(redis-cli --raw ping 2>&1 || true)
  case "$default_denied" in *NOAUTH*) ;; *) exit 1 ;; esac
  spring ping >/dev/null
  spring_denied=$(spring get meeting_analysis:acl-runbook 2>&1 || true)
  case "$spring_denied" in *NOPERM*) ;; *) exit 1 ;; esac
  fastapi set meeting_analysis:acl-runbook fixture >/dev/null
  fastapi del meeting_analysis:acl-runbook >/dev/null
  fastapi_denied=$(fastapi xlen meeting-analysis 2>&1 || true)
  case "$fastapi_denied" in *NOPERM*) ;; *) exit 1 ;; esac
'
curl -fsS http://127.0.0.1:8000/api/v1/health >/dev/null
curl -fsS http://127.0.0.1:8080/api/v1/health/ready >/dev/null
```

`appendonly=yes`, `appendfsync=everysec`, `maxmemory-policy=noeviction`이어야 한다. `ACL LIST`은
비밀번호 해시를 포함할 수 있으므로 배포 로그나 보고서에 출력하지 않는다.

### Spring 강제 종료 후 pending 복구

1. UI에서 테스트 회의록을 업로드하고 반환된 ID를 `MEETING_ID`로 기록한다.
2. 아래 명령의 `XPENDING` 첫 줄이 1 이상일 때 Spring 컨테이너를 강제 종료한다. 명령은
   메시지 ID·payload를 출력하지 않고 pending 개수만 출력한다.
3. Spring을 다시 시작한다. Worker는 인스턴스별 consumer 이름을 사용하며 다른 consumer에 남은
   pending이 10분 이상 idle이면 `XPENDING`/`XCLAIM`으로 회수한다. 실행 중에는 1분마다 현재
   consumer의 pending lease를 갱신해 정상 장기 작업이 다른 인스턴스에 회수되지 않게 한다.
   상태가 `completed` 또는 `failed`가 되고 pending 개수가 0인지 확인한다.

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T redis \
  sh -c 'REDISCLI_AUTH="$REDIS_ADMIN_PASSWORD" redis-cli --raw --user admin XPENDING meeting-analysis meeting-analysis-workers' \
  | sed -n '1p'
docker kill workflow-backend-spring
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d backend-spring
spring_ready=0
for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8080/api/v1/health/ready >/dev/null; then
    spring_ready=1
    break
  fi
  sleep 5
done
test "$spring_ready" = 1
pending_after=$(docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T redis \
  sh -c 'REDISCLI_AUTH="$REDIS_ADMIN_PASSWORD" redis-cli --raw --user admin XPENDING meeting-analysis meeting-analysis-workers' \
  | sed -n '1p')
test "$pending_after" = 0
curl -fsS -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://<도메인>/api/v1/projects/$PROJECT_ID/meetings/$MEETING_ID/status"
```

### Redis 컨테이너 재생성 후 AOF persistence

실행 전후 `XLEN`과 `XPENDING` 첫 줄만 별도 메모하고 payload는 조회하지 않는다. 두 값이 유지되어야 한다.

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml stop backend-spring
before_length=$(docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T redis \
  sh -c 'REDISCLI_AUTH="$REDIS_ADMIN_PASSWORD" redis-cli --raw --user admin XLEN meeting-analysis')
before_pending=$(docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T redis \
  sh -c 'REDISCLI_AUTH="$REDIS_ADMIN_PASSWORD" redis-cli --raw --user admin XPENDING meeting-analysis meeting-analysis-workers' \
  | sed -n '1p')
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --force-recreate redis
redis_ready=0
for attempt in $(seq 1 30); do
  if docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T redis \
      sh -c 'REDISCLI_AUTH="$REDIS_ADMIN_PASSWORD" redis-cli --raw --user admin ping' \
      2>/dev/null | grep -qx PONG; then
    redis_ready=1
    break
  fi
  sleep 2
done
test "$redis_ready" = 1
after_length=$(docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T redis \
  sh -c 'REDISCLI_AUTH="$REDIS_ADMIN_PASSWORD" redis-cli --raw --user admin XLEN meeting-analysis')
after_pending=$(docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T redis \
  sh -c 'REDISCLI_AUTH="$REDIS_ADMIN_PASSWORD" redis-cli --raw --user admin XPENDING meeting-analysis meeting-analysis-workers' \
  | sed -n '1p')
test "$after_length" = "$before_length"
test "$after_pending" = "$before_pending"
docker compose -f docker-compose.yml -f docker-compose.prod.yml restart backend-spring
```

재생성 후 Redis PING, `XLEN`, `XPENDING` 비교가 모두 통과해야 한다. named volume의 AOF가 유지되지 않으면
추가 업로드를 중단하고 복구한다.

### queue drain 후 AOF plaintext 제거

AOF에는 삭제 전 회의 payload가 평문으로 남을 수 있다. 신규 업로드를 막고 queue를 정상 처리한 뒤,
`XLEN`과 `XPENDING`이 모두 정확한 숫자 `0`일 때만 인증된 `BGREWRITEAOF`를 실행한다. 이 절차에서
`XRANGE`, `XREAD`, `GET` 등으로 payload 조회 금지이며 개수와 persistence 상태만 확인한다.

```bash
queue_length=$(docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T redis \
  sh -c 'REDISCLI_AUTH="$REDIS_ADMIN_PASSWORD" redis-cli --raw --user admin XLEN meeting-analysis')
queue_pending=$(docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T redis \
  sh -c 'REDISCLI_AUTH="$REDIS_ADMIN_PASSWORD" redis-cli --raw --user admin XPENDING meeting-analysis meeting-analysis-workers' \
  | sed -n '1p')
printf '%s\n' "$queue_length" | grep -Eq '^[0-9]+$'
printf '%s\n' "$queue_pending" | grep -Eq '^[0-9]+$'
test "$queue_length" = 0
test "$queue_pending" = 0
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T redis \
  sh -c 'REDISCLI_AUTH="$REDIS_ADMIN_PASSWORD" redis-cli --raw --user admin BGREWRITEAOF' \
  | grep -Eq 'Background append only file rewriting started|Background append only file rewriting scheduled'
rewrite_ok=0
for attempt in $(seq 1 60); do
  rewrite_status=$(docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T redis \
    sh -c 'REDISCLI_AUTH="$REDIS_ADMIN_PASSWORD" redis-cli --raw --user admin INFO persistence' \
    | grep -E '^(aof_rewrite_in_progress|aof_rewrite_scheduled|aof_last_bgrewrite_status):')
  if printf '%s\n' "$rewrite_status" | grep -q '^aof_rewrite_in_progress:0' \
    && printf '%s\n' "$rewrite_status" | grep -q '^aof_rewrite_scheduled:0' \
    && printf '%s\n' "$rewrite_status" | grep -q '^aof_last_bgrewrite_status:ok'; then
    rewrite_ok=1
    break
  fi
  sleep 2
done
test "$rewrite_ok" = 1
```

`unavailable`, 빈 값, 비숫자 또는 0이 아닌 값이면 fail closed로 중단하고 manual drain/compensation을
완료한 뒤 다시 실행한다. 또한 OCI 콘솔에서 Redis 데이터가 있는 boot/block volume과 backup의 저장
암호화가 활성화됐는지, volume 접근 권한이 최소 인원으로 제한됐는지, backup 보존 기간과 삭제 정책이
승인된 운영 정책과 일치하는지 확인한다.

### Redis enqueue 실패가 FAILED로 전환되는지 확인

테스트 회의만 사용한다. Redis를 멈춘 상태에서 UI로 회의록을 한 건 업로드하고, 응답으로 받은 회의가
`FAILED` 상태인지 확인한 뒤 Redis와 Spring을 복구한다. `PROCESSING`에 남으면 배포를 중단한다.

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml stop redis
# UI에서 테스트 회의 1건 업로드 후 MEETING_ID 기록
curl -fsS -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://<도메인>/api/v1/projects/$PROJECT_ID/meetings/$MEETING_ID/status"
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d redis
docker compose -f docker-compose.yml -f docker-compose.prod.yml restart backend-spring
```

### 회의 분석·RAG cache hit

- 회의 분석: 민감하지 않은 fixture를 동일 입력으로 두 번 분석한다. 두 응답이 같고 두 번째 응답 시간이
  짧아지며 admin 계정으로 key 이름만 조회했을 때 `meeting_analysis:` key가 생성되는지 확인한다.
- RAG: 같은 프로젝트·사용자 범위에서 완전히 같은 질문을 두 번 요청한다. 응답과 source가 같고 두 번째
  시간이 짧아지며 `rag_answer:` key가 생성되는지 확인한다.
- 업무·회의·프로젝트를 수정하거나 삭제한 뒤 같은 질문을 다시 요청한다. `rag_epoch:<projectId>`가
  증가하고 이전 답변 cache가 재사용되지 않으며 삭제한 source가 응답에 포함되지 않아야 한다.
- FastAPI를 잠시 중지한 상태에서 삭제·담당자 변경을 수행하면 `rag_assignee_sync_failures`에
  outbox 레코드가 남고, FastAPI 복구 후 스케줄러가 현재 DB 상태에 맞게 재처리해 제거하는지 확인한다.
- 브라우저 Network timing이나 `curl -w '%{time_total}'`만 기록한다. 질문, 회의 원문, 응답 payload는
  CI 로그나 보고서에 남기지 않는다.

### payload 로그 유출 검사

테스트 fixture에 민감하지 않은 고유 sentinel을 넣고 요청한 뒤, 일치 여부만 검사한다. `grep` 결과 자체를
출력하면 원문이 함께 노출될 수 있으므로 반드시 `-q`와 출력 리다이렉션을 사용한다.

```bash
if docker compose -f docker-compose.yml -f docker-compose.prod.yml logs backend-spring backend-fastapi 2>&1 \
  | grep -Fq 'OCI_PAYLOAD_SENTINEL_DO_NOT_LOG'; then
  echo "WARNING: payload marker found in logs"
  exit 1
fi
echo "payload marker absent from logs"
```

### rollback 전 queue 주의

이전 코드는 Redis Stream과 새 RAG 삭제·담당자·인제스트 outbox를 처리할 수 없습니다. rollback 전에 반드시
`XLEN meeting-analysis`, `XPENDING meeting-analysis meeting-analysis-workers`, 그리고
`rag_assignee_sync_failures`의 `delete:*`·`delete_project`·`sync:*`·`ingest:*` 개수만 기록한다. 세 값이
정확한 숫자 `0/0/0`인 경우에만 자동 rollback한다. 하나라도 `unavailable`, 빈 값, 비숫자 또는
0이 아닌 값이면 fail closed로 자동 rollback을 중단하고 신규 업로드를 막은 뒤
manual drain/compensation을 완료한다.

자동 rollback workflow는 최종 지표 수집 직전에 실행 중인 Spring을
`docker stop --time 60 workflow-backend-spring`으로 먼저 정지해 ingress와 Worker를 quiesce한다.
컨테이너가 없거나 이미 정지된 경우는 그대로 진행하지만, 실행 중인 컨테이너 정지에 실패하면 rollback을
중단한다. 최종 지표가 0/0/0이 아니거나 조회 불가이면 다음 절차로 현재 feature 버전을 drain한다.
payload 조회와 수동 XACK/XDEL 금지이며 개수만 확인한다.

```bash
docker stop workflow-frontend
docker start workflow-backend-spring
drain_complete=0
for attempt in $(seq 1 60); do
  drain_length=$(docker exec workflow-redis \
    sh -c 'REDISCLI_AUTH="$REDIS_ADMIN_PASSWORD" redis-cli --raw --user admin XLEN meeting-analysis' \
    2>/dev/null || printf unavailable)
  drain_pending=$(docker exec workflow-redis \
    sh -c 'REDISCLI_AUTH="$REDIS_ADMIN_PASSWORD" redis-cli --raw --user admin XPENDING meeting-analysis meeting-analysis-workers' \
    2>/dev/null | sed -n '1p' || printf unavailable)
  if printf '%s\n' "$drain_length" | grep -Eq '^[0-9]+$' \
    && printf '%s\n' "$drain_pending" | grep -Eq '^[0-9]+$' \
    && [ "$drain_length" -eq 0 ] && [ "$drain_pending" -eq 0 ]; then
    drain_complete=1
    break
  fi
  sleep 5
done
docker stop --time 60 workflow-backend-spring
test "$drain_complete" = 1
final_length=$(docker exec workflow-redis \
  sh -c 'REDISCLI_AUTH="$REDIS_ADMIN_PASSWORD" redis-cli --raw --user admin XLEN meeting-analysis')
final_pending=$(docker exec workflow-redis \
  sh -c 'REDISCLI_AUTH="$REDIS_ADMIN_PASSWORD" redis-cli --raw --user admin XPENDING meeting-analysis meeting-analysis-workers' \
  | sed -n '1p')
printf '%s\n' "$final_length" | grep -Eq '^[0-9]+$'
printf '%s\n' "$final_pending" | grep -Eq '^[0-9]+$'
test "$final_length" = 0
test "$final_pending" = 0
```

최종 0/0 확인 후에만 선택한 버전으로 수동 rollback하거나 DB compensation을 완료한다. Redis PING,
선택 버전의 local FastAPI/Spring health와 consumer group을 확인한 다음에만
`docker start workflow-frontend`로 public ingress를 복구한다.

## 문제 해결

**80/443이 안 열린다** — 2번(Security List)과 3번(iptables)을 둘 다 했는지 확인.
하나만 하면 안 된다. `sudo iptables -L INPUT -n --line-numbers`로 규칙을 확인한다.

**구글 로그인이 `redirect_uri_mismatch`** — `.env`의 `GOOGLE_REDIRECT_URI`와 구글 콘솔에
등록한 값이 정확히 같아야 한다. 끝의 슬래시 하나도 다르면 안 된다.

**로그인 후 http://로 튕긴다** — `SERVER_FORWARD_HEADERS_STRATEGY=framework`가 적용됐는지,
nginx가 `X-Forwarded-Proto`를 넘기는지 확인한다. 둘 다 `docker-compose.prod.yml`과
`nginx.prod.conf`에 들어 있다.

**빌드 중 OOM** — 12GB면 충분하지만, 실행 중인 스택과 빌드가 겹치면 빠듯할 수 있다.
`docker compose ... down` 후 빌드하거나 스왑을 임시로 추가한다.

**인증서 갱신 확인**

```bash
docker exec workflow-certbot certbot certificates
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs certbot
```
