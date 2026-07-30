# 워크로드/기여도 스코어 LangChain 트레이싱 재도입 설계

작성일: 2026-07-29
작성자: 이은주 (FS-5 ML/AI 모델링)
관련: [[2026-07-21-workload-langsmith-tracing-design]](이전 langsmith 단독 설계, `cd777a81`에서 삭제됨),
[[2026-07-28-workload-difficulty-axes-design]](3축 구조 리팩터링), `workload_model.py`, `workload_service.py`,
`contribution_score/app/services/contribution_service.py`

## 배경 / 목적

`get_workload_score()` 파이프라인에는 원래 LangSmith `@traceable` 데코레이터로 트레이싱이 붙어
있었다(2026-07-21 설계). 그런데 `cd777a81 refactor: 대시보드 LLM 의존성 제거` 커밋에서
`embedding_difficulty.py`/`tracing.py`가 통째로 삭제되면서 트레이싱도 함께 없어졌고, 그 이후
`workload_model.py`가 4피처 통합 구조에서 **3축 구조**(난이도 편중/업무량 편중/배정량 불균형,
`compute_axis_results()`)로 크게 리팩터링됐다(`anomaly_type: str` → `anomaly_types: list[str]`,
`difficulty_avg_rel` → `difficulty_score`/`workload_score`/`allocation_score` 등 필드 자체가 바뀜).
즉 트레이싱이 빠진 것과 3축 구조 전환은 같은 커밋 계열에서 겹쳐 일어난 별개의 변경이라, 이전
트레이싱 코드를 그대로 되살리는 것만으로는 동작하지 않는다.

이번 작업에서는:
1. 이전엔 `ml_workload_score`(워크로드 스코어)만 대상이었지만, 이번엔 그 이후 새로 생긴
   `contribution_score`(기여도 점수, workload/task/meeting 3피처 가중합)까지 트레이싱 범위를 넓힌다.
2. 이전엔 "LangChain 프레임워크는 도입하지 않고 `langsmith` SDK의 `@traceable`만 단독 사용"하기로
   결정했었지만, 이번엔 사용자가 **실제로 LangChain(`langchain-core`)의 `Runnable`/`@chain`으로
   감싸는 방향**을 택했다(raw ollama/sklearn 파이프라인이라는 이전 판단과 달리, 이번엔 명시적으로
   LangChain 도입을 확인받음).

## 사전 조사 결과 (이번 작업에서 실측 확인)

- `langchain-core==1.4.9`, `langsmith==0.10.2`는 RAG 챗봇 LangChain 전환(2026-07-21,
  `document_고무서/2026-07-21-langsmith-langchain-migration-design.md`) 때 이미
  `requirements.txt`에 추가되어 있고 `.venv`에 설치된 상태 — **이번 작업에서 새 패키지 설치 불필요**.
- `app/main.py`가 파일 최상단에서 이미 `load_dotenv()`를 호출한다 — `.env`의
  `LANGSMITH_API_KEY`/`LANGSMITH_TRACING`/`LANGSMITH_PROJECT`가 프로세스 환경변수로 반영되는
  경로는 이미 갖춰져 있다.
- **`@chain` 데코레이터로 감싼 함수는 더 이상 일반 함수처럼 직접 호출할 수 없다.** 실제로
  `.venv`의 `langchain_core.runnables.chain`으로 확인함:
  ```python
  @chain
  def build_features(tasks_df, today=None): ...

  build_features("df", today="t")   # TypeError: 'RunnableLambda' object is not callable
  build_features.invoke({"tasks_df": "df", "today": "t"})  # 동작하지만 인자를 dict 하나로 묶어야 함
  ```
  `build_features`/`detect_overload_anomalies_auto`/`compute_contribution_scores`는 현재
  위치 인자를 받는 일반 함수로 30개 이상의 테스트(`test_workload_model_*.py`,
  `test_contribution_*.py`)와 라우터에서 직접 호출되고 있다. 이 함수들 자체를 `@chain`으로
  감싸면 기존 호출부와 테스트가 전부 깨진다.
- `contribution_score` 모듈은 3축 구조가 도입된 이후에 만들어진 모듈이라 트레이싱이 적용된
  이력이 아예 없다(신규 계측).

## 범위

**포함**:
- `core/tracing.py`(신규) — `setup_langsmith()` 공유 유틸(기존 `ml_workload_score` 전용 →
  `contribution_score`도 같이 쓰므로 `core/`로 위치 이동).
- `ml_workload_score/app/services/workload_service.py` — `get_workload_score()` 내부에 트레이싱
  스텝 추가.
- `ml_workload_score/app/routers/workload_router.py` — 모듈 최상단 `setup_langsmith()` 호출 추가.
- `contribution_score/app/services/contribution_service.py` — `compute_contribution_scores()`
  내부에 트레이싱 스텝 추가.
- `contribution_score/app/routers/contribution_router.py` — 모듈 최상단 `setup_langsmith()`
  호출 추가.
- 관련 테스트(`core/tracing.py` 단위 테스트 신규, 기존 워크로드/기여도 테스트는 무수정 통과 확인).

**제외**:
- `build_features`/`detect_overload_anomalies_auto`/`workload_model.py`의 3축 판정 로직 자체
  변경 — 이번 스코프 아님, 계측만 추가.
- `embedding_difficulty.py` 복원 — `cd777a81`에서 삭제된 임베딩 난이도 보정 기능 자체를 되살리는
  것은 별도 작업(이번엔 트레이싱만).
- `llm_rag_assistant`의 기존 LangChain 사용(`generation_service.py` 등) — 이미 완료된 별도 작업,
  손대지 않는다.
- LangSmith `evaluate()` 기반 정량 평가 데이터셋 구축 — 트레이싱만, 평가 파이프라인은 비범위.

## 아키텍처

핵심 제약: **공개 함수 시그니처(`get_workload_score`, `build_features`,
`detect_overload_anomalies_auto`, `compute_contribution_scores`)는 전혀 바꾸지 않는다.**
LangChain으로 감싸는 부분은 각 서비스 함수 "내부"에 한정한다 — 그래야 기존 라우터 호출부와
`unittest.mock.patch("....build_features")` 패턴을 쓰는 기존 테스트가 무수정으로 그대로 통과한다.

```
core/tracing.py (신규, ml_workload_score/app/services/tracing.py 이관+공유화)
  setup_langsmith(project_name: str = "workflow-ai-backend") -> bool
    - dotenv_values() + os.environ 병합 패턴(workload_db.py와 동일)으로
      LANGSMITH_API_KEY, LANGSMITH_PROJECT를 읽음
    - 키 없으면 경고 로그 후 기존 LANGSMITH_TRACING 값도 정리, False 반환
    - 있으면 LANGSMITH_TRACING=true, LANGSMITH_PROJECT 세팅 후 True 반환
    - LangChain의 트레이싱은 langsmith SDK와 동일하게 LANGSMITH_TRACING 환경변수를
      읽으므로(공식 문서 확인: LANGSMITH_TRACING=true + LANGSMITH_API_KEY만 있으면
      LangChain Runnable 실행이 자동으로 LangSmith에 기록됨), 이 유틸 하나로 두 파이프라인
      모두 커버 가능.

workload_router.py / contribution_router.py 모듈 로드 시점(1회) setup_langsmith() 호출

ml_workload_score/app/services/workload_service.py
  get_workload_score(project_id, use_synthetic_fallback=False)   # 공개 시그니처 불변
    │  내부에서:
    │  tasks_df = await asyncio.to_thread(db.load_tasks_from_db, project_id)
    │  ...
    ├─ _build_features_step = chain(lambda payload: build_features(**payload))
    │    features = _build_features_step.invoke({"tasks_df": tasks_df})
    ├─ _detect_anomalies_step = chain(lambda payload: detect_overload_anomalies_auto(**payload))
    │    result = _detect_anomalies_step.invoke({"feature_df": features})
    └─ 전체를 감싸는 부모 span: _workload_score_chain = chain(_run_workload_pipeline)
         get_workload_score()는 이 체인을 await ...ainvoke(...)로 실행한 뒤 결과를 그대로 반환

contribution_score/app/services/contribution_service.py
  compute_contribution_scores(workload_members, attendance, total_meetings)  # 공개 시그니처 불변
    │  내부에서:
    └─ _contribution_score_chain = chain(_run_contribution_pipeline)
         compute_contribution_scores()는 이 체인을 .invoke(...)로 실행한 뒤 결과를 그대로 반환
         (팀원별 세분화 스팬은 만들지 않음 - 무거운 연산이 아니라 오버엔지니어링)
```

- `build_features`/`detect_overload_anomalies_auto` 함수 자체는 그대로 두고, 서비스 계층에서만
  `@chain`으로 감싼 **얇은 래퍼 람다**를 만들어 `.invoke()`한다. 이렇게 하면:
  - 기존 `test_workload_model_*.py`(6개 파일, `build_features(tasks_df, today=...)` 직접 호출)는
    전혀 손대지 않아도 통과.
  - 기존 `test_workload_service.py`의 `patch("....build_features")`/
    `patch("....detect_overload_anomalies_auto")` 모킹은, 서비스 코드가 여전히 모듈 레벨
    `build_features`/`detect_overload_anomalies_auto` 심볼을 참조·호출하므로(람다 내부에서
    호출) 패치가 그대로 먹힌다. **단, 람다를 모듈 최상단이 아니라 `get_workload_score()` 함수
    본문 안에서 매 호출마다 새로 만들어야** patch 시점(테스트가 patch를 건 이후 함수 진입) 이후의
    최신 심볼을 참조한다 — 모듈 로드 시점에 미리 만들어두면 patch 이전 원본 함수를 클로저로
    캡처해버려 mock이 무시된다.
- LangChain `@chain`에는 langsmith `@traceable`의 `process_inputs`/`process_outputs` 같은 훅이
  없다. 대신 각 체인 스텝의 입력을 "요약 dict"로 만들어 전달하고, 실제 무거운 DataFrame/멤버
  리스트는 별도 클로저 변수로 다음 단계에 넘기는 방식으로 페이로드 크기를 관리한다(아래
  "트레이스 payload 크기 관리" 참조).

## 3축 구조로 바뀌어도 적용되는가?

**적용된다.** 트레이싱은 함수의 입출력 "값"이 무엇이냐와 무관하게, 함수 "호출 자체"를 감싸는
구조라서 3축 구조 전환으로 필드가 바뀐 것과 독립적이다. 다만 이전 설계(2026-07-21)가 트레이스에
기록하던 요약 통계 필드 자체는 구버전 스키마를 참조하고 있었으므로 그대로 재사용할 수 없고,
이번에 3축 구조에 맞게 다시 만든다:

- `build_features` 트레이스 입력 요약: `{"row_count": len(tasks_df), "member_count": tasks_df["assignee_id"].nunique()}`
- `build_features` 트레이스 출력 요약: `{"feature_count": len(features)}` (원본 DataFrame 대신)
- `detect_overload_anomalies_auto` 트레이스 출력 요약(3축 구조 반영, 라벨 목록은
  `workload_model.py`의 `_labels()`에 정의된 6개 문자열 그대로 사용):
  ```python
  _ANOMALY_LABELS = [
      "난이도 편중 의심", "난이도 이상 패턴(방향 불명확)",
      "업무량 편중 의심", "업무량 이상 패턴(방향 불명확)",
      "배정량 불균형", "배정 이상 패턴(방향 불명확)",
  ]

  {
      "method_used": result.attrs.get("method_used"),
      "member_count": len(result),
      "anomaly_count": int(result["is_anomaly"].sum()),
      "anomaly_type_breakdown": {
          label: sum(label in types for types in result["anomaly_types"])
          for label in _ANOMALY_LABELS
      },
  }
  ```
- `compute_contribution_scores` 트레이스 출력 요약:
  ```python
  {
      "member_count": len(results),
      "avg_contribution_score": round(sum(r.contribution_score for r in results) / len(results), 1) if results else None,
      "weight_workload": WEIGHT_WORKLOAD, "weight_task": WEIGHT_TASK, "weight_meeting": WEIGHT_MEETING,
  }
  ```

## 트레이스 payload 크기 관리

- `tasks_df`(팀원별 개인 업무 원본), `WorkloadMemberResult`/`ContributionMemberResult` 전체
  리스트(개인 식별 가능 데이터)는 트레이스에 그대로 넣지 않는다 — 위 요약 dict만 체인 스텝의
  "명목상 입력/출력"으로 넘기고, 실제 무거운 데이터는 파이썬 클로저로 다음 단계에 직접 전달한다.
  구체적으로, 체인 람다는 `(summary_for_trace, actual_data)` 튜플이 아니라 **실제 연산은 그대로
  수행하되 반환값만 실제 결과 그대로 두고, 별도의 "trace-only 로깅 스텝"을 하나 더 두는 대신** —
  구현 단순성을 위해 다음 방식을 채택한다:
  - 체인 함수는 실제 입력(DataFrame 등)을 받아 실제 연산을 수행하고 실제 결과를 반환한다(정상
    동작 그대로).
  - LangSmith에 큰 DataFrame이 그대로 직렬화되어 올라가는 문제는, `langchain_core`가 결국
    `repr()`/`str()` 또는 pydantic 직렬화를 시도하다 실패하면 타입명만 기록하는 것으로 확인되면
    그대로 두고, 실제로 전체 텍스트가 올라가는 것이 확인되면(구현 단계 첫 검증 스텝) 체인 함수의
    인자/반환값 자체를 위 요약 dict로 제한하고 실제 DataFrame은 모듈 레벨 캐시나 별도 인자로
    빼는 방식으로 조정한다. 어느 쪽이든 원본 텍스트(업무 제목 등)나 개인 식별 데이터가 그대로
    외부(LangSmith)로 전송되지 않는 것이 이번 설계의 하드 요구사항이다 — 이전
    `embedding_difficulty.py`의 `_summarize_embed_inputs` 방어 패턴과 동일한 원칙.

## 에러 처리

- `setup_langsmith()`는 앱 시작 시 예외를 던지지 않는다 — 키 없으면 경고 로그 후 `False` 반환.
- LangChain Runnable 실행(`.invoke()`)이 트레이스 전송 실패로 인해 파이프라인 자체를 실패시켜서는
  안 된다. `LANGSMITH_TRACING`이 꺼져 있거나 키가 없으면 LangChain은 콜백 없이 로컬에서 그냥
  실행되므로(트레이싱은 콜백 핸들러 레이어라 완전히 분리됨), 정상 동작에는 영향이 없다 — 이 점은
  구현 단계에서 `LANGSMITH_API_KEY` 없는 상태로 실제 실행해 확인한다.
- 기존 "보강 신호 실패해도 본 기능은 살아있어야 한다"는 철학 유지: 트레이싱은 관찰만 하고 절대
  실제 응답/예외 흐름에 관여하지 않는다.

## 의존성

- 신규 설치 없음. `requirements.txt`의 `langchain-core==1.4.9`, `langsmith==0.10.2`를 그대로 재사용.
- `convention/ai.md`의 "LLM(LangChain)" 표에 `contribution_score`/`ml_workload_score`도 LangChain을
  사용한다는 사실을 반영하도록 갱신(현재 "RAG 챗봇 라우터에 적용됨"으로만 적혀 있음).

## 테스트 계획

- `tests/core/test_tracing.py`(신규): `setup_langsmith()` 단위 테스트
  - `LANGSMITH_API_KEY` 미설정 시 `False` 반환 + `LANGSMITH_TRACING` 환경변수 미세팅 확인.
  - 설정 시 `True` 반환 + `LANGSMITH_TRACING == "true"`, `LANGSMITH_PROJECT` 기본값/커스텀값 확인.
- 회귀 확인: 기존 `test_workload_model_*.py`(6개), `test_workload_service.py`,
  `test_workload_router.py`, `test_contribution_*.py`(4개)는 **수정 없이 그대로 통과**해야 한다.
- 체인 래퍼 스모크 테스트(신규, `test_workload_service.py`/`test_contribution_service.py`에 추가):
  - `get_workload_score()`/`compute_contribution_scores()`가 LangChain으로 감싼 뒤에도 여전히
    동일한 반환 타입(`WorkloadScoreData`/`list[ContributionMemberResult]`)과 값을 내는지 확인.
  - `build_features`/`detect_overload_anomalies_auto`를 patch했을 때 patch가 실제로 호출되는지
    (mock.call_count >= 1) 확인 — 체인 래퍼가 원본 함수 호출을 우회하지 않는지 검증.
- LangSmith 서버로 실제 trace가 전송되는지는 유닛 테스트 범위 밖(외부 서비스 의존) — 로컬에서
  실제 `LANGSMITH_API_KEY`로 한 번 실행해 대시보드에서 수동 확인.

## 알려진 한계

- `@chain` 래퍼가 만드는 스팬은 함수 이름이 아니라 람다/래퍼 함수 이름으로 표시될 수 있어,
  LangSmith 대시보드에서 가독성을 위해 `.with_config({"run_name": "build_features"})` 등으로
  명시적 이름을 부여해야 한다(구현 단계에서 확정).
- LangChain 트레이싱과 langsmith `@traceable`을 혼용하지 않는다 — 이번 스코프는 LangChain
  Runnable 계측으로 통일한다(`llm_rag_assistant`가 이미 LangChain 전용으로 전환된 것과 일관성
  유지).
- 팀원별 세분화된 트레이스(멤버 1명당 1스팬)는 만들지 않는다 — 필요해지면 별도 확장.
