from __future__ import annotations

import importlib
import json
import subprocess
import sys
import textwrap
from pathlib import Path
from unittest.mock import patch

# App/backend_fastapi 디렉터리 - ml_workload_score 임포트가 여기 cwd 기준으로 풀린다
# (python -m pytest와 동일하게, 서브프로세스도 cwd로 이 경로를 넘긴다).
_BACKEND_FASTAPI_DIR = Path(__file__).resolve().parents[2]


def _run_in_subprocess(script: str) -> dict:
    """
    langsmith SDK는 트레이싱 활성화 여부를 프로세스 전역 상태로 한 번 결정하면
    이후 환경변수를 바꿔도 재평가하지 않는 내부 캐싱 동작이 있다(버전
    0.10.9에서 실측 확인됨 - 같은 프로세스 안에서 비활성 상태로 한 번이라도
    호출되면, 그 뒤 환경변수를 켜도 활성화되지 않음). 그래서 "비활성" 케이스와
    "활성" 케이스를 완전히 분리된 프로세스에서 각각 검증해야 신뢰할 수 있는
    결과가 나온다 - 같은 pytest 프로세스 안에서 두 시나리오를 순서대로 돌리면
    SDK의 이 캐싱 때문에 실제로는 재현되지 않는 거짓 결과를 얻는다(직접 겪은 문제).
    """
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=str(_BACKEND_FASTAPI_DIR),
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, (
        f"subprocess failed (exit {result.returncode})\n"
        f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
    )
    return json.loads(result.stdout.strip().splitlines()[-1])


def test_build_features_creates_no_langsmith_run_when_tracing_disabled():
    """
    @traceable가 '완전한 no-op'이라는 가정을 실제 langsmith SDK 호출 경로로 검증한다
    (우리 자체 헬퍼 함수 단위 테스트가 아니라, 실제 Client.create_run/update_run이
    호출되는지 여부로 확인 - 자동 리뷰가 지적한 '실제 SDK 동작 미검증' 갭을 메운다).
    """
    script = textwrap.dedent("""
        import json, os
        os.environ.pop("LANGSMITH_TRACING", None)
        os.environ.pop("LANGSMITH_API_KEY", None)
        from unittest.mock import patch
        import pandas as pd
        from ml_workload_score.app.services.workload_model import build_features

        df = pd.DataFrame([
            {"task_id": 1, "project_id": 1, "assignee_id": "a", "category": "backend",
             "priority": "high", "status": "todo", "due_date": pd.Timestamp("2026-08-01")},
        ])
        with patch("langsmith.client.Client.create_run") as mock_create_run, \\
             patch("langsmith.client.Client.update_run") as mock_update_run:
            result = build_features(df)

        print(json.dumps({
            "result_rows": len(result),
            "create_run_called": mock_create_run.called,
            "update_run_called": mock_update_run.called,
        }))
    """)
    output = _run_in_subprocess(script)

    assert output["result_rows"] == 1
    assert output["create_run_called"] is False
    assert output["update_run_called"] is False


def test_build_features_creates_langsmith_run_with_summarized_inputs_when_tracing_enabled():
    """
    트레이싱이 켜졌을 때 실제로 Client.create_run이 호출되고, 그 inputs가
    build_features의 reducer(_summarize_build_features_inputs)가 만든 요약 dict와
    정확히 일치하는지 확인한다 - 전체 DataFrame이 아니라 요약만 SDK로 넘어가는지를
    실제 호출 인자로 검증(단순히 reducer 함수를 독립적으로 호출해보는 것과는 다름).
    """
    script = textwrap.dedent("""
        import json, os
        os.environ["LANGSMITH_TRACING"] = "true"
        os.environ["LANGSMITH_API_KEY"] = "lsv2_test_fake_key_not_real"
        from unittest.mock import patch
        import pandas as pd
        from ml_workload_score.app.services.workload_model import build_features

        df = pd.DataFrame([
            {"task_id": 1, "project_id": 1, "assignee_id": "a", "category": "backend",
             "priority": "high", "status": "todo", "due_date": pd.Timestamp("2026-08-01")},
        ])
        with patch("langsmith.client.Client.create_run") as mock_create_run, \\
             patch("langsmith.client.Client.update_run"):
            build_features(df)

        assert mock_create_run.call_count == 1, mock_create_run.call_count
        _, kwargs = mock_create_run.call_args
        print(json.dumps({
            "name": kwargs["name"],
            "run_type": kwargs["run_type"],
            "inputs": kwargs["inputs"],
        }))
    """)
    output = _run_in_subprocess(script)

    assert output["name"] == "build_features"
    assert output["run_type"] == "tool"
    assert output["inputs"] == {
        "tasks_df_rows": 1,
        "tasks_df_columns": ["task_id", "project_id", "assignee_id", "category", "priority", "status", "due_date"],
        "embedding_adjustments_count": 0,
    }


def test_embed_creates_langsmith_run_without_leaking_original_text():
    """
    _embed는 임의의 text_value(향후 업무 원문으로 호출될 수 있음)를 받는 함수인데
    process_inputs가 없으면 @traceable이 그 원문을 가공 없이 그대로 SDK에 넘긴다
    (리뷰 지적사항: '개인 데이터 없이 요약 통계만 전송'한다는 설명과 불일치할 뻔했음).
    실제 Client.create_run 호출 인자에 원문 텍스트가 전혀 없고 글자 수만 있는지
    확인한다 - reducer 함수 단위 테스트가 아니라 실제 SDK 호출 경로로 검증.
    """
    script = textwrap.dedent("""
        import json, os
        os.environ["LANGSMITH_TRACING"] = "true"
        os.environ["LANGSMITH_API_KEY"] = "lsv2_test_fake_key_not_real"
        from unittest.mock import AsyncMock, patch
        import asyncio
        from ml_workload_score.app.services import embedding_difficulty as mod

        sensitive_text = "실제 업무 내용이 담긴 민감할 수 있는 원문 텍스트입니다."

        async def main():
            fake_client = AsyncMock()
            fake_client.embeddings = AsyncMock(return_value={"embedding": [0.1, 0.2, 0.3]})
            with patch(
                "ml_workload_score.app.services.embedding_difficulty.ollama.AsyncClient",
                return_value=fake_client,
            ), patch("langsmith.client.Client.create_run") as mock_create_run, \\
               patch("langsmith.client.Client.update_run"):
                await mod._embed(sensitive_text)

            assert mock_create_run.call_count == 1, mock_create_run.call_count
            _, kwargs = mock_create_run.call_args
            return {
                "name": kwargs["name"],
                "inputs": kwargs["inputs"],
                "sensitive_text_leaked": sensitive_text in json.dumps(kwargs["inputs"]),
            }

        print(json.dumps(asyncio.run(main())))
    """)
    output = _run_in_subprocess(script)

    assert output["name"] == "ollama_embed"
    assert output["sensitive_text_leaked"] is False
    assert output["inputs"] == {"text_length": len("실제 업무 내용이 담긴 민감할 수 있는 원문 텍스트입니다.")}


def test_router_import_order_does_not_prevent_tracing_from_activating():
    """
    workload_router.py는 setup_langsmith()를 호출하기 전에
    workload_service(및 @traceable이 적용된 하위 모듈들)를 먼저 import한다.
    langsmith SDK의 get_env_var()가 @functools.lru_cache로 캐싱되는 것을 확인했는데
    (리뷰 지적: import 시점에 환경변수를 평가/캐싱해버리면 나중에 setup_langsmith()가
    .env 기반으로 세팅해도 이미 "비활성"으로 캐싱돼 늦어버릴 수 있음), traceable()
    데코레이터 자체는 함수 *정의* 시점이 아니라 함수가 실제 *호출*될 때만
    tracing_is_enabled()/get_env_var()를 평가한다 - 즉 데코레이터가 적용된 모듈을
    먼저 import해도, 아직 그 함수들이 호출되지 않았다면 캐싱이 선점되지 않는다.
    라우터의 실제 import 순서 그대로(workload_service import → setup_langsmith() →
    엔드포인트 첫 호출)를 재현해, .env로만 제공된 API 키로도 실제 Client.create_run이
    호출되는지 서브프로세스에서 직접 검증한다.
    """
    script = textwrap.dedent("""
        import json, os, asyncio
        os.environ.pop("LANGSMITH_TRACING", None)
        os.environ.pop("LANGSMITH_API_KEY", None)
        from unittest.mock import patch

        # setup_langsmith()는 dotenv_values()로 .env를 직접 읽으므로, 실제 .env 파일을
        # 건드리지 않고 그 반환값만 mock한다.
        with patch(
            "ml_workload_score.app.services.tracing.dotenv_values",
            return_value={"LANGSMITH_API_KEY": "lsv2_test_fake_key_not_real"},
        ), patch("langsmith.client.Client.create_run") as mock_create_run, \\
           patch("langsmith.client.Client.update_run"):
            # workload_router.py와 정확히 동일한 순서로 import된다:
            # tracing.setup_langsmith 임포트 -> workload_service(및 @traceable 하위
            # 모듈들) 임포트 -> setup_langsmith() 호출(라우터 모듈 최상단).
            import ml_workload_score.app.routers.workload_router as router_module

            result = asyncio.run(
                router_module.get_workload_score(project_id=1, use_synthetic_fallback=True)
            )

        print(json.dumps({
            "create_run_called": mock_create_run.called,
            "create_run_count": mock_create_run.call_count,
        }))
    """)
    output = _run_in_subprocess(script)

    assert output["create_run_called"] is True
    assert output["create_run_count"] > 0


def test_setup_langsmith_is_invoked_when_router_module_is_loaded():
    """
    workload_router.py 모듈 로드 시 setup_langsmith()가 실제로 호출되는 전역
    부수효과를 직접 검증한다 (지금까지는 setup_langsmith() 자체의 로직만 단위
    테스트했을 뿐, 라우터가 실제로 그걸 부르는지는 확인한 적이 없었다).
    patch를 건 상태에서 모듈을 처음 임포트하면 그 임포트 자체가 이미 1회
    호출을 발생시키므로(모듈 최상단의 setup_langsmith() 호출문), reload로
    한 번 더 부르는 것과 합쳐 "최소 1회 이상 호출됐다"만 확인한다 - 정확한
    호출 횟수(최초 임포트 vs reload)는 이 테스트가 검증하려는 요점이 아니다.
    """
    with patch("ml_workload_score.app.services.tracing.setup_langsmith") as mock_setup:
        import ml_workload_score.app.routers.workload_router as router_module
        importlib.reload(router_module)

    mock_setup.assert_called()


def test_inference_still_returns_when_langsmith_run_creation_fails():
    """UT-177. 추적 전송이 실패해도 추론 결과는 그대로 나와야 한다.

    LangSmith는 부가 관측 수단이라, 그쪽 장애가 업무 편중 점수 계산을 막으면 안 된다.
    트레이싱을 켠 상태에서 Client.create_run이 예외를 던지도록 만들어, build_features가
    그 예외에 휩쓸리지 않고 정상 결과를 반환하는지 확인한다.

    위의 '활성' 케이스와 마찬가지로 별도 프로세스에서 돌린다 - langsmith SDK가 트레이싱
    활성 여부를 프로세스 전역으로 한 번만 결정하기 때문이다.
    """
    script = textwrap.dedent("""
        import json, os
        os.environ["LANGSMITH_TRACING"] = "true"
        os.environ["LANGSMITH_API_KEY"] = "test-key"
        os.environ["LANGSMITH_PROJECT"] = "workflow-test"
        from unittest.mock import patch
        import pandas as pd
        from ml_workload_score.app.services.workload_model import build_features

        df = pd.DataFrame([
            {"task_id": 1, "project_id": 1, "assignee_id": "a", "category": "backend",
             "priority": "high", "status": "todo", "due_date": pd.Timestamp("2026-08-01")},
            {"task_id": 2, "project_id": 1, "assignee_id": "b", "category": "backend",
             "priority": "low", "status": "done", "due_date": pd.Timestamp("2026-08-01")},
        ])
        with patch("langsmith.client.Client.create_run", side_effect=RuntimeError("langsmith down")), \\
             patch("langsmith.client.Client.update_run", side_effect=RuntimeError("langsmith down")):
            result = build_features(df)

        print(json.dumps({
            "result_rows": len(result),
            "assignees": sorted(result["assignee_id"].tolist()),
        }))
    """)
    output = _run_in_subprocess(script)

    assert output["result_rows"] == 2
    assert output["assignees"] == ["a", "b"]
