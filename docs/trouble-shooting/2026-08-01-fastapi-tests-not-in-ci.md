# FastAPI 테스트가 CI에서 한 번도 실행되지 않던 문제

- 발견: 2026-08-01 (질의 라우팅 변경이 CI 검증 없이 머지될 뻔함)
- 조치: `.github/workflows/fastapi-tests.yml` 추가 → 배포 게이트에 연결 → 통합 테스트 5건 수리
- 상태: 397건 전부 CI에서 실행, 배포를 실제로 막음

## 증상

`backend-tests.yml`은 Spring gradle 만 실행한다. FastAPI 쪽은 테스트가 397개 있어도
**아무도 실행하지 않았다.** 2026-07-23 장애 때 Spring에 CI를 붙인 것과 똑같은 상태가
FastAPI 쪽에 그대로 남아 있었다.

실제로 2026-08-01 어시스턴트 질의 라우팅 변경이 CI 검증을 전혀 못 받고 머지될 뻔했고,
다중 코드 슬롯 독점 결함은 사람 리뷰로만 잡혔다.

## 같이 드러난 것 — 테스트가 개발자 로컬 `.env`에 오염됐다

CI를 붙이려고 전체 스위트를 돌려보니 **21건이 실패**했다. 그런데
`test_generation_service.py`를 단독으로 돌리면 73건 전부 통과했다. 실행 순서에 따라
결과가 달라지고 있었다.

### 원인

```python
# app/main.py:5
load_dotenv()
```

FastAPI 앱을 임포트하는 것만으로 `App/.env` 값이 `os.environ`에 **영구히** 주입된다.
그 뒤로 도는 모든 테스트가 그 값을 본다.

`.env`에는 `RAG_PROVIDER`가 있다. 이 값이 있으면 `generation_service._explicit_provider()`가
자동 폴백 체인 대신 고정 백엔드를 고르므로, 테스트가 패치한 HuggingFace 경로를 아예 타지
않는다. 그래서 16건이 무너졌다.

앱을 임포트하는 파일 셋 중 아무거나 앞에 오면 재현된다.

```
test_assistant_router.py
test_chat_router_query.py
test_rag_internal_auth.py
```

한 줄짜리 파일로도 재현된다.

```python
from app.main import app   # 이것만으로 test_generation_service 16건이 깨진다
```

### 왜 위험했나

`.env`는 `.gitignore` 대상이라 **CI에는 없다.** 즉 로컬에서만 빨갛고 CI에서는 초록인
상태였다. 개발자는 "원래 몇 개는 빨간 거"라고 학습하고 스위트 전체를 안 믿게 된다.
그 상태에서 진짜 회귀가 섞여 들어오면 구분할 방법이 없다.

### 조치

`tests/llm_rag_assistant/conftest.py`에 autouse 픽스처를 넣어 백엔드 선택 환경변수를
테스트마다 지운다. `monkeypatch`로 지우므로 스스로 `setenv` 하는 테스트는 그대로 자기
값을 쓴다. 설정은 `lru_cache`되므로 캐시도 같이 비운다.

| | 조치 전 | 조치 후 |
| --- | --- | --- |
| 실패 | 21건 | **5건** |
| 실행 시간 | 102초 | **45초** |

실행 시간이 준 것은 더 이상 실제 LLM 프로바이더를 호출하지 않기 때문이다.

## CI 구성

`.github/workflows/fastapi-tests.yml`

- 트리거: `App/backend_fastapi/**`, `requirements.txt`, 워크플로 자신
- Python 3.12.13 (`.python-version`과 동일)
- torch는 CPU 전용 휠로 따로 설치한다. `requirements.txt`에 없지만
  `sentence-transformers`가 요구하고 **테스트 수집 시점에 이미 임포트**되므로 없으면
  한 건도 못 돈다.
- 실행 건수 하한을 `ci/verify-fastapi-test-count.py`로 못 박는다.

### 워크플로를 붙이는 것만으로는 배포를 막지 못했다

워크플로를 추가한 직후에도 **배포는 여전히 FastAPI 를 검증하지 않았다.** `deploy-oci.yml`은
`main` push 에서만 돌고, 자기 게이트로 Spring(`test`)과 프론트(`frontend`)만 요구했다.
`fastapi-tests.yml`은 그 옆에서 병렬로 돌 뿐 `deploy`의 `needs`에 없었다.

실제로 2026-08-01 질의 라우팅 배포(run 30698374508)가 그 상태로 나갔다. FastAPI 테스트는
같은 시각에 통과했지만(run 30698374514) **통과가 배포 조건이 아니었으므로 우연이었다.**

`deploy-oci.yml`에 `fastapi` 잡을 추가하고 `deploy`가 이 잡에 의존하게 했다.

```yaml
fastapi:
  uses: ./.github/workflows/fastapi-tests.yml   # 스텝 복사 금지 - 아래 참고

deploy:
  needs: [test, frontend, fastapi]
```

스텝을 `deploy-oci.yml`에 복사하지 않고 재사용 워크플로로 호출한다. 복사하면 torch 버전이나
`--ignore` 목록을 한쪽만 고쳤을 때 **배포 게이트가 PR 에서 돈 것과 다른 것을 검증하게 된다.**
같은 파일의 migration-guard 주석이 정확히 그 실패를 기록하고 있다.

`fastapi-tests.yml`의 push 트리거에서는 `main`을 뺐다. 안 빼면 같은 테스트가 두 번 돌고
상태 체크가 두 개 뜨는데 그중 하나만 배포를 막아, 방금 고친 혼란이 그대로 재생된다.

### 건수 하한을 두는 이유

pytest는 `--ignore`를 하나 더 붙이거나 파일이 통째로 수집되지 않아도 **"통과"로 끝난다.**
그러면 CI는 초록불인데 실제로는 아무것도 안 지킨다. **방어선이 있는 척하는 쪽이 없는
것보다 나쁘다.** Spring 쪽 `verify-context-test-ran.py`와 같은 이유다.

테스트를 늘리면 `MINIMUM_TESTS`도 같이 올린다.

## 통합 테스트 5건 — 테스트가 프로세스 밖으로 새고 있었다 (해결)

```
test_rag_indexing_integration.py   2건
test_rag_reindex_integration.py    3건
```

처음에는 "스텁이 안 먹는다"로 봤다. 테스트가 답변 생성을 고정 문자열로 덮는데

```python
monkeypatch.setattr(chat_service, "generate_answer", _generate)   # "테스트용 고정 답변"
```

응답은 `근거 없음: 관련 자료를 찾지 못했습니다`가 나왔다. 이 문자열은 운영 코드 어디에도
없고 **오직 프롬프트 안에만 있다**(`generation_service.py:23`). 진짜 모델이 호출됐다는 뜻이다.

### 진짜 원인

`/ai/rag/query`는 `chat_service.answer_question`을 부르지 않는다.

```python
# chat_router.py:75
return await enqueue_and_wait(request.project_id, request.question, ...)
```

Redis 스트림 `rag-jobs`에 작업을 넣고 `RagQueueWorker`가 결과를 publish하기를 기다린다.
**그 워커는 테스트 프로세스 밖에 있다.** 그래서 실제로 일어난 일은:

```
테스트 → workflow-redis(:6379) → rag-jobs 스트림
                                      ↓
                    workflow-backend-fastapi 컨테이너의 RagQueueWorker
                                      ↓
                    자기 DB + 진짜 LLM 호출 → 결과를 다시 publish
                                      ↓
                                   테스트가 수신
```

즉 monkeypatch도, `dependency_overrides[get_pool]`도, 띄운 테스트컨테이너도 **전부 무관했다.**
답변은 로컬 compose 워커가 자기 DB를 읽어 만든 것이었다. 그 워커가 붙어 있던 곳:

```
DATABASE_URL=postgresql://postgres.<...>@aws-1-ap-south-1.pooler.supabase.com:6543/postgres
```

**동결된 Supabase 운영 데이터다.** 실패 diff에 실제 업무 제목과 사람 이름이 그대로 찍혀
있었고, 테스트를 돌릴 때마다 LLM 토큰이 나갔다. `--ignore`로 가려 둔 것이 결과적으로는
다행이었다 — CI에는 Redis가 없어 이 누수가 재현되지 않는다.

`TRUNCATE document_chunks`가 운영을 건드리지는 않았다. 그건 테스트컨테이너에만 걸렸고,
운영 DB는 읽히기만 했다.

### 왜 이렇게 됐나

큐는 **나중에** 라우터와 `chat_service` 사이에 끼어든 인프라다. 테스트가 처음 쓰였을 때는
`chat_router`가 `answer_question`을 직접 불렀고 스텁이 정확히 맞았다. 큐가 들어오면서
테스트는 조용히 무력화됐지만, 로컬 워커가 그럴듯한 답을 돌려주는 바람에 "실패하는 테스트"로
보였을 뿐 "새는 테스트"로는 보이지 않았다.

### 조치

큐 홉을 걷어내고 워커가 하는 일(`rag_queue_service._process`)을 같은 프로세스에서 한다.

```python
async def _answer_in_process(project_id, question, user_id, history=None, timeout=None):
    return await chat_service.answer_question(
        pgvector_pool, project_id, question, user_id, history=history or []
    )

monkeypatch.setattr(chat_router, "enqueue_and_wait", _answer_in_process)
```

풀을 직접 건네는 이유: `query` 엔드포인트는 pool을 `Depends`로 받지 않는다(워커가 자기 전역
풀을 쓴다). 그래서 `dependency_overrides`로는 못 넘긴다.

| | 조치 전 | 조치 후 |
| --- | --- | --- |
| 결과 | 5건 실패 | **5건 통과** |
| 실행 시간 | 40초 | **8초** |
| 읽은 DB | Supabase 운영 | **테스트컨테이너** |
| LLM 호출 | 실제 | **없음** |

시간이 준 것은 네트워크 왕복과 실제 모델 추론이 사라졌기 때문이다.

**커버되지 않는 것**: 큐 적재·구독·타임아웃 자체. 그건 `rag_queue_service` 단위 테스트가 본다.
이 파일들의 검증 대상은 첫 줄에 적힌 대로 청킹·벡터 직렬화·INSERT·유사도 검색·출처 조립이다.

### 남는 교훈

**엔드포인트와 서비스 사이에 인프라를 끼워 넣으면 그 경로를 타던 테스트는 조용히 죽는다.**
죽었는지 알아채려면 테스트가 프로세스 밖으로 나가지 못하게 막아야 한다. 지금은 Redis에
붙는 순간 로컬 환경이 답을 대신 만들어 줘서 실패가 "그냥 빨간 것"으로 보였다.
