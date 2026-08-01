# FastAPI 테스트가 CI에서 한 번도 실행되지 않던 문제

- 발견: 2026-08-01 (질의 라우팅 변경이 CI 검증 없이 머지될 뻔함)
- 조치: `.github/workflows/fastapi-tests.yml` 추가
- 남은 일: 통합 테스트 5건 (아래 "제외한 것")

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

## 제외한 것 — 통합 테스트 5건 (미해결)

```
test_rag_indexing_integration.py   2건
test_rag_reindex_integration.py    3건
```

이 변경 **이전부터 실패하던 것**이고 질의 라우팅과 무관하다(변경 전후 동일하게 실패).

### 지금까지 파악한 것

테스트는 `chat_service.generate_answer`를 고정 문자열 스텁으로 덮는다.

```python
monkeypatch.setattr(chat_service, "generate_answer", _generate)   # "테스트용 고정 답변"
```

그런데 응답은 `근거 없음: 관련 자료를 찾지 못했습니다`가 나온다. 이 문자열은 운영 코드
어디에도 없고 **오직 프롬프트 안에만 있다**(`generation_service.py:23`, 모델에게 근거가
없으면 이렇게 답하라고 지시하는 문장). **즉 스텁이 안 먹고 진짜 모델이 호출됐다는 뜻이다.**

응답이 `chat_service.answer_question`이 아닌 다른 경로(그래프 등)로 나오고 있을 가능성이
높다. 그렇다면 이 테스트들은 지금 의도한 것을 검증하고 있지 않다.

DB는 안전하다 — `pgvector_dsn`은 테스트컨테이너를 띄우므로 `TRUNCATE document_chunks`는
일회용 컨테이너에만 적용된다. 운영 DB와 무관하다.

### 다음에 할 일

1. `_query` 헬퍼가 때리는 엔드포인트가 실제로 어느 생성 경로를 타는지 확인
2. 스텁을 그 경로에 맞게 걸거나, 테스트 의도를 다시 정의
3. 고쳐지면 워크플로의 `--ignore` 두 줄을 지우고 `MINIMUM_TESTS`를 올린다

**`--ignore`를 그대로 두는 한 이 5건은 아무도 안 본다.** 이 문서가 그 사실을 붙들고 있다.
