package com.workflowai.meeting;

import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Pattern;

/**
 * 서비스가 제공한 회의록 양식(.docx)으로 작성된 문서를 섹션 단위로 나눈다.
 *
 * <p>양식으로 작성되지 않은 문서는 {@link Optional#empty()}를 돌려주고, 호출부는 기존
 * 전체 텍스트 키워드 분석 경로를 그대로 탄다.
 *
 * <p>양식은 사내 회의록 서식(회색 라벨 열 + 격자)이라 섹션 구분이 "회의내용", "결정사항" 같은
 * 라벨 칸으로 되어 있다. docx 텍스트 추출은 표를 행 순서대로 셀마다 한 줄씩 풀어내므로
 * 라벨 줄 다음에 그 칸의 내용 줄이 온다. 예전 번호 매김 양식("3. 결정 사항")도 계속 인정한다.
 *
 * <p>실행항목 칸의 우선순위 체크 줄은 FastAPI가 읽어야 하므로 여기서 지우지 않고 넘긴다.
 */
public final class MeetingTemplateParser {
    private MeetingTemplateParser() {}

    /** 6개 섹션 중 이만큼은 잡혀야 "양식으로 작성된 문서"로 인정한다. */
    private static final int MIN_RECOGNIZED_HEADINGS = 3;

    private enum Section { AGENDA, DISCUSSION, DECISIONS, TODOS, ISSUES, NEXT_MEETING }

    /**
     * 사내 서식의 라벨 칸. 번호가 없으므로 줄 전체가 라벨과 정확히 일치할 때만 인정한다.
     * 짧은 라벨 한 단어가 통째로 한 줄을 이루는 경우는 표의 라벨 칸뿐이라, 본문 문장이
     * 헤딩으로 오인될 여지가 거의 없다.
     */
    private static final Map<String, Section> LABEL_HEADINGS = Map.ofEntries(
        Map.entry("회의주제", Section.AGENDA),
        Map.entry("회의안건", Section.AGENDA),
        Map.entry("안건", Section.AGENDA),
        Map.entry("회의내용", Section.DISCUSSION),
        Map.entry("논의내용", Section.DISCUSSION),
        Map.entry("결정사항", Section.DECISIONS),
        Map.entry("실행항목", Section.TODOS),
        Map.entry("액션아이템", Section.TODOS),
        Map.entry("액션 아이템", Section.TODOS),
        Map.entry("할일", Section.TODOS),
        Map.entry("할 일", Section.TODOS),
        Map.entry("비고", Section.ISSUES),
        Map.entry("특이사항", Section.ISSUES),
        Map.entry("차기회의", Section.NEXT_MEETING),
        Map.entry("다음회의", Section.NEXT_MEETING)
    );

    /**
     * 번호를 매긴 예전 양식용 판정 규칙. 번호를 필수로 요구해 본문 문장이 헤딩으로 오인되는 것을
     * 막는다("결정 사항은 다음과 같다" 같은 줄은 번호가 없어 걸리지 않는다).
     */
    private static final Map<Section, Pattern> NUMBERED_HEADINGS = new EnumMap<>(Map.of(
        Section.AGENDA, compile("안건"),
        Section.DISCUSSION, compile("(?:회의|논의)\\s*내용"),
        Section.DECISIONS, compile("결정\\s*사항"),
        Section.TODOS, compile("(?:실행\\s*항목|액션\\s*아이템|할\\s*일|to\\s*-?\\s*do)"),
        Section.ISSUES, compile("(?:비고|특이사항|리스크|이슈|위험)"),
        Section.NEXT_MEETING, compile("(?:차기|다음)\\s*회의")
    ));

    /**
     * 양식이 스스로 인쇄한 문구들. 사용자가 지우지 않았을 뿐 회의 내용이 아니므로 본문에서 뺀다.
     * 상단 정보란 라벨은 첫 헤딩보다 앞에 있어 자연히 버려지지만, 하단 결재란은 마지막 섹션
     * 뒤에 오므로 반드시 걸러야 비고 내용에 섞이지 않는다.
     */
    private static final List<String> BOILERPLATE_LINES = List.of(
        // "회의종류"·"참석인원"·"참석자"는 신양식에서 뺐지만, 그 양식으로 이미 쓴 문서가 있다.
        "회의 제목", "회의종류", "작성자", "참석인원", "참석자", "일시", "장소",
        "우선순위", "결재", "팀장", "부서장", "대표",
        // 신양식 실행항목 표(실행 항목 · 담당자 · 완료 기한 · 우선순위)의 열 제목.
        // "실행 항목"은 띄어쓰기가 있어 섹션 라벨 "실행항목"과 겹치지 않는다.
        "실행 항목", "담당자", "완료 기한",
        "회의를 진행하는 목적",
        "다룰 안건",
        "회의 중 나온 논의를 자세히 적어주세요.",
        "회의에서 확정된 내용을 적어주세요.",
        "특이사항 · 리스크 · 다음 회의 일정을 적어주세요."
    );

    private static final List<String> BOILERPLATE_PREFIXES = List.of("내용 (", "※");

    /**
     * 실행항목 예시 행("(예시) 박지수 · ...")의 접두사. 목록에 문구 전체를 넣지 않은 이유는
     * 사용자가 예시를 지우지 않고 그 아래에 이어서 적는 경우가 흔한데, 그러면 뒤 문구가
     * 조금만 달라져도 목록 방식은 걸러내지 못하기 때문이다.
     */
    private static final String EXAMPLE_LINE_PREFIX = "(예시)";

    private static Pattern compile(String heading) {
        return Pattern.compile(
            "^\\s*\\d+\\s*[.)]?\\s*" + heading + ".*$",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE
        );
    }

    public static Optional<MeetingSections> parse(String text) {
        if (text == null || text.isBlank()) {
            return Optional.empty();
        }

        Map<Section, List<String>> bodies = new EnumMap<>(Section.class);
        Section current = null;

        for (String line : text.split("\n")) {
            Section heading = headingOf(line);
            if (heading != null) {
                // 같은 헤딩이 두 번 나오면 뒤엣것을 이어 붙인다. 본문에 우연히 걸린 줄 하나 때문에
                // 앞서 모은 내용을 통째로 버리는 것보다 낫다.
                bodies.computeIfAbsent(heading, key -> new ArrayList<>());
                current = heading;
                continue;
            }
            if (current != null && !line.isBlank() && !isBoilerplate(line)) {
                bodies.get(current).add(line.trim());
            }
        }

        if (bodies.size() < MIN_RECOGNIZED_HEADINGS) {
            return Optional.empty();
        }

        return Optional.of(new MeetingSections(
            bodyOf(bodies, Section.DISCUSSION),
            bodyOf(bodies, Section.DECISIONS),
            bodyOf(bodies, Section.TODOS),
            bodyOf(bodies, Section.ISSUES)
        ));
    }

    private static boolean isBoilerplate(String line) {
        String trimmed = line.trim();
        if (BOILERPLATE_LINES.contains(trimmed)) {
            return true;
        }
        if (trimmed.startsWith(EXAMPLE_LINE_PREFIX)) {
            return true;
        }
        return BOILERPLATE_PREFIXES.stream().anyMatch(trimmed::startsWith);
    }

    private static Section headingOf(String line) {
        String trimmed = line.trim();
        Section labelled = LABEL_HEADINGS.get(trimmed);
        if (labelled != null) {
            return labelled;
        }
        for (Map.Entry<Section, Pattern> entry : NUMBERED_HEADINGS.entrySet()) {
            if (entry.getValue().matcher(line).matches()) {
                return entry.getKey();
            }
        }
        return null;
    }

    private static String bodyOf(Map<Section, List<String>> bodies, Section section) {
        List<String> lines = bodies.get(section);
        return lines == null ? "" : String.join("\n", lines);
    }
}
