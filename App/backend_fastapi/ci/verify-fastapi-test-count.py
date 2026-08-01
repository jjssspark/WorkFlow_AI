#!/usr/bin/env python3
"""FastAPI 테스트가 기대한 만큼 실제로 실행됐는지 확인한다.

pytest 는 --ignore 를 하나 더 붙이거나 파일이 통째로 수집되지 않아도 "통과"로 끝난다.
그러면 CI 는 초록불인데 실제로는 아무것도 안 지키는 상태가 된다 - 방어선이 있는 척하는
쪽이 없는 것보다 나쁘다. 그래서 실행 건수의 하한을 못 박는다.

테스트를 늘렸으면 MINIMUM_TESTS 도 같이 올린다. 줄이려면 왜 줄이는지 이유를 남긴다.
"""
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

# 2026-08-01 기준 실행 건수는 392다(통합 테스트 2파일 제외). 테스트를 지우지 않는 한
# 이 아래로 내려갈 수 없다. 여유를 조금 두어 무관한 파라미터화 조정에 매번 걸리지는 않게 한다.
MINIMUM_TESTS = 380


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: verify-fastapi-test-count.py <junit-xml>", file=sys.stderr)
        return 2

    report = Path(sys.argv[1])
    if not report.is_file():
        print(f"[FAIL] JUnit 리포트가 없습니다: {report}", file=sys.stderr)
        print("       pytest 가 실행 자체를 못 했다는 뜻이므로 통과시키지 않는다.", file=sys.stderr)
        return 1

    root = ET.parse(report).getroot()
    # pytest 는 <testsuites><testsuite>...로 감싸기도 하고 <testsuite> 단독이기도 하다.
    suites = root.findall("testsuite") if root.tag == "testsuites" else [root]

    total = skipped = failures = errors = 0
    for suite in suites:
        total += int(suite.get("tests", 0))
        skipped += int(suite.get("skipped", 0))
        failures += int(suite.get("failures", 0))
        errors += int(suite.get("errors", 0))

    executed = total - skipped
    print(f"수집 {total}건 / 건너뜀 {skipped}건 / 실제 실행 {executed}건 "
          f"(실패 {failures}, 오류 {errors})")

    if executed < MINIMUM_TESTS:
        print(f"[FAIL] 실행된 테스트가 {executed}건으로 하한 {MINIMUM_TESTS}건에 못 미칩니다.",
              file=sys.stderr)
        print("       테스트가 조용히 빠졌는지 확인하세요(--ignore 추가, 수집 실패, 건너뜀).",
              file=sys.stderr)
        print("       의도적으로 줄인 것이라면 이 스크립트의 MINIMUM_TESTS 를 이유와 함께 낮추세요.",
              file=sys.stderr)
        return 1

    print(f"[OK] 하한 {MINIMUM_TESTS}건을 넘겼습니다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
