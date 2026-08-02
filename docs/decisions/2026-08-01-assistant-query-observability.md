# 어시스턴트 질의 관측: Redis 일별 카운터

- 날짜: 2026-08-01
- 상태: **설계 승인 대기** (구현 전)
- 선행: [2026-08-01-assistant-query-routing.md](2026-08-01-assistant-query-routing.md),
  [중복 청크 문제](../trouble-shooting/2026-08-01-duplicate-chunks-crowd-out-evidence.md)
  (중복 청크 문서와 "코드 4개 이상" 수정은 PR #540 에 있고 아직 dev 에 머지되지 않았다 —
  이 문서 기준 링크가 깨져 보이면 그 PR 이 아직 열려 있다는 뜻이다)

## 맥락

질의 라우팅과 중복 제거를 넣었지만 **효과를 모른다.** 코드가 든 질문이 실사용에서 몇 %인지
모르므로 체감 개선 폭을 예측할 수 없고, 보류한 pg_trgm 하이브리드를 언제 재검토할지도
정할 수 없다. 오늘 고친 "코드 4개 이상" 처리도 실제로 그런 질문이 오는지 모르는 채 고쳤다.

### 오늘 드러난 것 — 기존 관측은 존재하지 않았다

라우팅 설계 때 "관측: 라우팅 발동 시 info 로그 1줄"을 넣기로 했고 실제로 코드에 있다.

```python
logger.info("코드 라우팅 발동: 코드 %d개, 정확 일치 %d건", len(codes), len(code_rows))
```

**이 줄은 운영에서 한 번도 찍힌 적이 없다.** 세 가지로 확인했다.

1. 기동 명령이 `uvicorn app.main:app` 뿐이다(`--log-config`·`--log-level` 없음).
   uvicorn 기본 설정은 `uvicorn*` 로거만 잡고, 앱 로거는 핸들러 없는 루트로 전파돼
   `logging.lastResort`가 WARNING 이상만 내보낸다.
2. 같은 설정을 로컬에서 재현해 `logger.info`를 불렀더니 아무것도 출력되지 않았다.
3. 운영 컨테이너 로그에 해당 문자열 0건.

`logger.warning`은 `lastResort` 덕분에 우연히 나온다. 즉 **INFO 관측은 무엇을 넣어도
사라진다.** 이 설정을 먼저 고치지 않으면 이번 작업도 같은 함정에 빠진다.

### 그리고 로그는 축적 수단이 될 수 없다

운영 컨테이너 로그는 **재배포마다 초기화된다.** 확인 시점 기준 전체 9줄이었고 전부 uvicorn
기동 메시지였다. 배포는 하루에 여러 번 일어난다. 로그 수집 인프라(loki/fluentd 등)는 없다.

## 답해야 하는 질문

| # | 질문 | 무엇을 결정하나 |
| --- | --- | --- |
| 1 | 코드가 든 질문 비중 | 라우팅의 체감 효과. 낮으면 다음 투자는 의미 검색 쪽 |
| 2 | 코드 개수 분포 | 오늘 고친 "4개 이상"이 실재하는 문제였나 |
| 3 | 나열한 코드가 잘린 비율 | `top_k` 상한을 올릴 이유가 있나 |
| 4 | 개인화 질문 비중 | 라우팅 미적용 경로의 크기 |
| 5 | 근거가 `top_k` 미만인 비율 | 중복 제거 후에도 근거가 모자라나 |

**다섯 개 전부 집계다. 질문 원문이 필요 없다.** 개인정보 문제가 설계에서 통째로 사라진다.

## 선택

**Redis 일별 카운터 + 로깅 설정 수정.**

### 왜 Redis인가

- **스키마 변경이 없다.** 마이그레이션·승인 게이트 없이 시작할 수 있어 데이터가 빨리 쌓인다.
- **재배포에 살아남는다.** `appendonly yes` + `/data` 볼륨을 운영에서 확인했다.
- **죽은 테이블이 될 수 없다.** `assistant_messages`가 2026-07-29에 삭제됐다 — "AI Assistant
  대화 이력"으로 정의됐지만 아무도 쓰지 않아서다. 테이블을 안 만들면 그 실패를 반복할 수 없다.
- 목적이 "우선순위를 정하기 위한 몇 주짜리 측정"이지 영구 제품 텔레메트리가 아니다.
  영구 지표가 필요해지면 그때 DB로 옮긴다.

## 버린 대안

- **DB 집계 테이블** — SQL이 자유롭고 조인이 되지만 마이그레이션·승인이 필요하고, 읽는
  방법을 같이 만들지 않으면 `assistant_messages`가 된다. 지금 필요한 다섯 질문에는 과하다.
- **질의별 로그 테이블** — 원문을 넣으면 개인정보, 안 넣으면 집계 테이블과 차이가 없다.
  행이 계속 쌓여 보존 정책도 필요하다.
- **구조화된 stdout 로그** — 재배포마다 날아가므로 축적이 목적인 이번 건에 부적합하다.
  다만 로깅 설정 자체는 아래처럼 별도로 고친다.

## 설계

### 1. 로깅 설정 (선행 조건)

`app/main.py`에서 임포트 시점에 루트 로거를 명시적으로 세운다.

```python
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
```

uvicorn은 앱을 임포트하기 **전에** 자기 `dictConfig`를 적용하는데, 그 설정은 루트에
핸들러를 달지 않는다. 따라서 뒤에 도는 `basicConfig`가 루트 핸들러를 추가한다.

**이 변경에는 반드시 테스트를 붙인다.** 지금 문제의 본질은 "관측이 조용히 사라진 것"이므로,
사라졌는지 자동으로 알 수 있어야 한다.

```python
def test_app_loggers_actually_emit_info():
    """uvicorn 기본 설정만으로는 앱 로거의 INFO 가 어디에도 나가지 않는다.
    이 테스트가 깨지면 관측이 통째로 사라진 것이다 - 값만 고쳐 통과시키지 말 것."""
    import app.main  # noqa: F401
    logger = logging.getLogger("llm_rag_assistant.app.services.retrieval_service")
    assert logger.isEnabledFor(logging.INFO)
    assert logging.getLogger().handlers
```

`caplog`로 검증하면 안 된다 — pytest가 자기 핸들러를 붙이므로 설정이 깨져 있어도 통과한다.

### 2. 카운터 키

```
rag_stats:{YYYY-MM-DD}      (Redis Hash, TTL 90일)
```

날짜는 UTC 기준으로 만든다(서버 타임존 설정에 흔들리지 않기 위해). 해석할 때 KST와 9시간
차이가 난다는 점만 문서에 남긴다.

| 필드 | 증가 조건 |
| --- | --- |
| `total` | 질문 경로 호출마다 |
| `proj_{id}` | 질문 경로 호출마다 (프로젝트 분포) |
| `personal` | `assignee_id`가 있을 때 (라우팅 미적용) |
| `codes_0` ~ `codes_4`, `codes_5plus` | 개인화가 아닐 때, 추출된 코드 개수 |
| `codes_truncated` | 코드 수 > 배정 칸 수 |
| `code_miss` | 코드는 있는데 정확 일치 0건 (없는 코드/폴백) |
| `sources_short` | 최종 근거 수 < `top_k` |

`proj_{id}`를 넣는 이유: `project_id=1`은 테스트 주입 데이터가 섞인 데모다. 프로젝트 분포를
모르면 "코드 질문 30%"가 실사용인지 데모 조작인지 구분할 수 없다.

### 3. 어디서 쓰는가

`search_chunks_for_question` 안. 이 함수만이 `codes`, `code_rows`, 최종 `rows`,
`assignee_id`를 전부 알고 있다. 다른 곳에서 하려면 값을 밖으로 실어 날라야 한다.

현재 이 함수는 조기 반환이 4곳이라 그대로 두면 계측을 네 번 써야 한다. **단일 출구로
정리하고 반환 직전에 한 번만 기록한다.** 이 정리는 이번 변경의 일부다.

계측 자체는 `services/rag_stats.py` 에 둔다. Redis 세부와 실패 처리를 한 곳에 가두어
`retrieval_service`가 캐시 인프라를 직접 알지 않게 한다.

### 4. 실패 정책 — 질의를 절대 죽이지 않는다

```python
try:
    ...pipeline 실행...
except Exception:
    logger.warning("질의 통계 기록 실패", exc_info=True)
```

`advance_rag_project_epoch`가 이미 같은 정책이다("캐시는 DB 원본의 파생물이므로 무효화
실패가 원본 변경 API를 실패시켜서는 안 된다"). 통계는 그보다도 부수적이다.

`HINCRBY` 여러 개 + `EXPIRE`를 **파이프라인 한 번**으로 보낸다. Redis가 같은 compose
네트워크에 있어 왕복은 1ms 미만이고, 질의 전체는 LLM 호출로 초 단위다.

### 5. Redis ACL (공유 인프라 수정 — 별도 승인 필요)

`fastapi` 계정은 키 패턴이 엄격히 제한돼 있다. 선택자를 추가하지 않으면 **런타임에
NOPERM으로 조용히 실패한다.** 2026-07-30에 정확히 그 사고가 있었다(rag-jobs 누락으로
RAG 큐가 통째로 죽음).

`App/redis/users.acl.template`의 `fastapi` 줄 끝에 추가:

```
(~rag_stats:* +hincrby +expire)
```

키 이름은 기존 규칙(`rag_answer:*`, `rag_epoch:*`)에 맞춰 밑줄을 쓴다.

주의: ACL 파일은 **주석을 지원하지 않는다.** 모든 줄이 `user`로 시작해야 하며 아니면
redis-server가 기동을 중단한다. 설명은 `redis-entrypoint.sh`의 주석 블록에 추가한다.

### 6. 읽는 방법 (이게 없으면 만들 이유가 없다)

`admin` 계정은 `~*`라 별도 권한이 필요 없다. 서버에서 바로 읽는다.

```
docker exec workflow-redis sh -c \
  'REDISCLI_AUTH="$REDIS_ADMIN_PASSWORD" redis-cli --user admin HGETALL rag_stats:2026-08-15'
```

여러 날을 합산해 보기 위한 스크립트를 함께 추가한다(**새 파일**):

```
App/backend_fastapi/scripts/show_rag_stats.py    # 최근 N일 집계·비율 출력
```

## 검증 계획

관측을 넣는 작업이 또 "있는 척"으로 끝나지 않도록, 각 항목에 확인 수단을 붙인다.

| 항목 | 확인 방법 |
| --- | --- |
| 로깅이 실제로 나가는가 | 위 `test_app_loggers_actually_emit_info` (CI) |
| 카운터가 맞는 조건에 오르는가 | 조건별 단위 테스트 (CI) |
| Redis 실패가 질의를 죽이지 않는가 | 예외 주입 테스트 (CI) |
| ACL이 실제로 허용하는가 | 실제 Redis 컨테이너에 붙여 `HINCRBY` 성공 확인 |
| 운영에서 실제로 쌓이는가 | 배포 후 `HGETALL`로 눈으로 확인 |

### 겸사겸사 고칠 것 — `test_redis_compose.sh`

501줄짜리 ACL 테스트가 있는데 **CI에서 돌지 않고, 이미 깨져 있다.** 169행이 `fastapi` ACL
줄을 고정 문자열로 검사하는데 2026-07-30 보강 이후의 템플릿과 일치하지 않는다.

ACL을 건드리는 이 작업에서 그대로 두면 방어선이 하나 더 "있는 척"으로 남는다.
최소한 169행을 현재 템플릿에 맞추고, CI 편입 여부는 별도로 판단한다.

## 되돌리는 법

`revert` 커밋 하나. 스키마도 데이터도 건드리지 않는다. ACL 줄과 `rag_stats.py`,
호출 지점, 로깅 설정이 전부다. 남은 Redis 키는 TTL 90일로 스스로 사라진다.

로깅 설정만은 되돌리지 않기를 권한다 — 그건 이 기능과 무관하게 고쳐야 할 결함이다.

## 한계

- **일 단위**라 시간대별 분포는 못 본다. 필요해지면 키를 시간 단위로 쪼갠다.
- **UTC 기준**이라 KST 자정 전후 질의가 다른 날로 잡힌다.
- `FLUSHALL` 하면 소실된다. 백업 대상이 아니다.
- 질문 내용·답변 품질은 측정하지 않는다(의도적).
- 프로젝트별 세분화는 `proj_{id}` 카운트뿐이다. "프로젝트 A의 코드 질문 비중"은 못 본다.
  필요하면 키를 `rag_stats:{date}:{project_id}`로 쪼개야 하는데, 지금 다섯 질문에는 과하다.

## 다음 단계

승인되면 두 덩어리로 나눠 진행한다. 각각 독립적으로 동작·검증 가능하다.

1. **로깅 설정 + 테스트** — 관측의 전제. 이것만으로도 기존 `logger.info`들이 살아난다.
2. **카운터 + ACL + 읽기 스크립트** — ACL은 공유 인프라라 별도 확인을 받는다.
