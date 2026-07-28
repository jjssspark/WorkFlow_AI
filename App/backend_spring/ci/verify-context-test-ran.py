#!/usr/bin/env python3
"""PostgreSQL/Testcontainers 기반 운영 방어 테스트가 실제로 실행됐는지 확인한다.

이 테스트들은 Docker가 없으면 조용히 건너뛴다(로컬 개발 편의). CI 게이트에서까지
건너뛰면 배선 오류를 잡는 방어선이 사라지므로, JUnit 리포트를 파싱해 실행 여부를
명시적으로 확인한다. 속성 순서나 공백에 의존하는 문자열 매칭 대신 XML로 파싱한다.
"""
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

SUITES = (
    "com.workflowai.ApplicationContextLoadTest",
    "com.workflowai.migration.ProductionSchemaMigrationTest",
    # 통합 테스트(PostgresRedisIntegrationTest 상속)도 Docker가 없으면 통째로 건너뛴다.
    # 여기 등록하지 않으면 러너에 Docker가 없을 때 아무 경고 없이 초록불이 된다.
    "com.workflowai.common.HealthReadinessIntegrationTest",
    "com.workflowai.common.ErrorEnvelopeIntegrationTest",
    "com.workflowai.assistant.AssistantThreadIntegrationTest",
    # 이건 Docker를 쓰지 않지만 같은 이유로 등록한다. RAG 색인은 best-effort라 실패해도
    # 화면이 깨지지 않으므로, 이 테스트가 조용히 실행되지 않으면 와이어 포맷이 깨진 사실을
    # 알아챌 다른 방법이 없다.
    "com.workflowai.rag.FastApiRagClientWireContractTest",
    "com.workflowai.rag.RagFastApiBoundaryIntegrationTest",
    # 어시스턴트 응답은 들어오는 방향이라 필드명이 어긋나도 예외가 없다. card가 조용히
    # null이 되어 확인 카드만 화면에서 사라지므로, 이 테스트가 안 돌면 알 방법이 없다.
    "com.workflowai.assistant.FastApiAssistantClientWireContractTest",
    # 인증 경로(IT-003/004/006/007). 토큰 발급과 검증이 서로를 목으로 두고 있어, 이 세 클래스가
    # 건너뛰어지면 "발급한 토큰을 이 앱이 받아들이는가"를 확인하는 테스트가 하나도 남지 않는다.
    "com.workflowai.auth.AuthLifecycleIntegrationTest",
    "com.workflowai.auth.GoogleOAuthLoginIntegrationTest",
    "com.workflowai.auth.TestAccountConcurrentLoginIntegrationTest",
)
REPORT_DIR = Path("build/test-results/test")


def fail(message: str) -> None:
    print(f"[FAIL] {message}", file=sys.stderr)
    sys.exit(1)


def verify_suite(suite_name: str) -> None:
    report = REPORT_DIR / f"TEST-{suite_name}.xml"
    if not report.is_file():
        fail(f"리포트가 없습니다: {report} — 테스트가 아예 실행되지 않았습니다.")

    try:
        suite = ET.parse(report).getroot()
    except ET.ParseError as error:
        fail(f"리포트를 파싱할 수 없습니다: {error}")

    def count(name: str) -> int:
        raw = suite.get(name)
        if raw is None:
            fail(f"리포트에 '{name}' 속성이 없습니다 — 리포트 형식이 바뀌었습니다.")
        try:
            return int(raw)
        except ValueError:
            fail(f"'{name}' 값이 정수가 아닙니다: {raw!r}")
        raise AssertionError("unreachable")

    tests, skipped = count("tests"), count("skipped")
    failures, errors = count("failures"), count("errors")

    # <skipped/> 자식 요소로도 교차 확인한다. 두 표현이 어긋나면 형식 변화로 보고 막는다.
    skipped_elements = len(suite.findall(".//skipped"))
    if skipped_elements != skipped:
        fail(f"skipped 속성({skipped})과 <skipped> 요소 수({skipped_elements})가 다릅니다.")

    if tests < 1:
        fail(f"실행된 테스트가 없습니다 (tests={tests}).")
    if skipped:
        fail(
            f"테스트가 건너뛰어졌습니다 (skipped={skipped}). "
            "CI 러너에 Docker가 없으면 Testcontainers가 비활성화됩니다."
        )
    if failures or errors:
        fail(f"테스트가 실패했습니다 (failures={failures}, errors={errors}).")

    print(f"[OK] {suite_name} 실행 확인 (tests={tests}, skipped=0)")


def main() -> None:
    for suite_name in SUITES:
        verify_suite(suite_name)


if __name__ == "__main__":
    main()
