package com.workflowai.meeting;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Optional;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class MeetingTemplateParserTest {

    private static final String FULL_TEMPLATE = String.join("\n",
        "회의록",
        "1. 안건",
        "결제 모듈 진행 점검",
        "2. 논의 내용",
        "결제 모듈 진행 상황을 공유했다.",
        "3. 결정 사항",
        "PG사는 A社로 간다.",
        "4. 액션 아이템",
        "김민준이 연동 코드를 다음 주까지 작성한다.",
        "5. 특이사항 · 리스크",
        "테스트 계정 발급이 늦어지고 있다.",
        "6. 차기 회의",
        "일시: 2026-08-09"
    );

    @Test
    @DisplayName("양식 전체를 채운 문서는 섹션별 본문으로 분리된다")
    void parse_fullTemplate_splitsSections() {
        MeetingSections sections = MeetingTemplateParser.parse(FULL_TEMPLATE).orElseThrow();

        assertThat(sections.discussion()).isEqualTo("결제 모듈 진행 상황을 공유했다.");
        assertThat(sections.decisions()).isEqualTo("PG사는 A社로 간다.");
        assertThat(sections.todos()).isEqualTo("김민준이 연동 코드를 다음 주까지 작성한다.");
        assertThat(sections.issues()).isEqualTo("테스트 계정 발급이 늦어지고 있다.");
    }

    @Test
    @DisplayName("안건·차기 회의 섹션 본문은 담지 않는다 — 회의 메타는 업로드 모달 입력값이 단일 출처다")
    void parse_doesNotCarryOverviewOrNextMeeting() {
        MeetingSections sections = MeetingTemplateParser.parse(FULL_TEMPLATE).orElseThrow();

        assertThat(sections.discussion()).doesNotContain("결제 모듈 진행 점검");
        assertThat(sections.issues()).doesNotContain("2026-08-09");
    }

    @Test
    @DisplayName("섹션 3개만 남은 문서도 양식으로 인정한다")
    void parse_threeHeadings_isRecognized() {
        String partial = String.join("\n",
            "2. 논의 내용",
            "일정 재조정을 논의했다.",
            "3. 결정 사항",
            "배포는 다음 주로 미룬다.",
            "4. 액션 아이템",
            "이서연이 배포 체크리스트를 정리한다."
        );

        MeetingSections sections = MeetingTemplateParser.parse(partial).orElseThrow();

        assertThat(sections.decisions()).isEqualTo("배포는 다음 주로 미룬다.");
        assertThat(sections.issues()).isEmpty();
    }

    @Test
    @DisplayName("섹션이 2개뿐이면 양식으로 보지 않는다 — 호출부가 기존 분석 경로로 폴백한다")
    void parse_twoHeadings_isNotRecognized() {
        String partial = String.join("\n",
            "3. 결정 사항",
            "배포는 다음 주로 미룬다.",
            "4. 액션 아이템",
            "이서연이 체크리스트를 정리한다."
        );

        assertThat(MeetingTemplateParser.parse(partial)).isEmpty();
    }

    @Test
    @DisplayName("번호 없는 자유 형식 회의록은 양식으로 오인되지 않는다")
    void parse_freeFormDocument_isNotRecognized() {
        String freeForm = String.join("\n",
            "오늘 회의에서는 결정 사항이 여러 개 나왔다.",
            "할 일도 정리했고 위험 요소도 공유했다.",
            "논의 내용은 아래와 같다."
        );

        assertThat(MeetingTemplateParser.parse(freeForm)).isEmpty();
    }

    @Test
    @DisplayName("번호 뒤 구두점과 공백, To-Do 표기가 흔들려도 인식한다")
    void parse_headingVariations_areRecognized() {
        String variations = String.join("\n",
            "2) 논의내용",
            "진행 상황을 공유했다.",
            "3 결정사항",
            "일정을 확정했다.",
            "4. To-Do",
            "김민준이 문서를 작성한다."
        );

        MeetingSections sections = MeetingTemplateParser.parse(variations).orElseThrow();

        assertThat(sections.discussion()).isEqualTo("진행 상황을 공유했다.");
        assertThat(sections.decisions()).isEqualTo("일정을 확정했다.");
        assertThat(sections.todos()).isEqualTo("김민준이 문서를 작성한다.");
    }

    @Test
    @DisplayName("헤딩만 있고 본문이 빈 섹션은 빈 문자열이 된다")
    void parse_emptySectionBody_isBlank() {
        String emptyBodies = String.join("\n",
            "2. 논의 내용",
            "3. 결정 사항",
            "4. 액션 아이템",
            "김민준이 문서를 작성한다."
        );

        MeetingSections sections = MeetingTemplateParser.parse(emptyBodies).orElseThrow();

        assertThat(sections.discussion()).isEmpty();
        assertThat(sections.decisions()).isEmpty();
        assertThat(sections.todos()).isEqualTo("김민준이 문서를 작성한다.");
    }

    @Test
    @DisplayName("표로 된 양식에서 안내 문구는 걸러내고 우선순위 체크 줄은 남긴다")
    void parse_tableTemplate_dropsBoilerplateAndKeepsPriorityRows() {
        // docx 표는 행 순서대로 셀마다 한 줄로 풀린다 — 실제 추출 결과 형태를 그대로 재현했다.
        String tableTemplate = String.join("\n",
            "회 의 록",
            "1. 안건",
            "결제 모듈 진행 점검",
            "2. 논의 내용",
            "회의 중 나온 논의를 자세히 적어주세요.",
            "3. 결정 사항",
            "PG사는 A사로 확정한다.",
            "4. 액션 아이템",
            "우선순위",
            "내용 (누가 · 무엇을 · 언제까지)",
            "[v] 긴급 [ ] 보통 [ ] 낮음",
            "김민준이 결제 API 연동을 8/10까지 마무리한다.",
            "[ ] 긴급 [v] 보통 [ ] 낮음",
            "이서연이 테스트 코드를 다음 주까지 작성한다.",
            "※ 해당하는 우선순위의 대괄호 안에 v 를 넣어주세요. 예: [v] 긴급",
            "5. 특이사항 · 리스크",
            "테스트 계정 발급이 늦어지고 있다."
        );

        MeetingSections sections = MeetingTemplateParser.parse(tableTemplate).orElseThrow();

        // 표 머리글과 안내 문구는 회의 내용이 아니다.
        assertThat(sections.todos()).doesNotContain("우선순위\n");
        assertThat(sections.todos()).doesNotContain("내용 (");
        assertThat(sections.todos()).doesNotContain("※");
        // 사용자가 손대지 않은 안내 문구가 논의 내용으로 잡히지 않아야 한다.
        assertThat(sections.discussion()).isEmpty();
        // 우선순위 체크 줄은 FastAPI가 읽어야 하므로 그대로 남는다.
        assertThat(sections.todos()).contains("[v] 긴급");
        assertThat(sections.todos()).contains("김민준이 결제 API 연동을 8/10까지 마무리한다.");
        assertThat(sections.decisions()).isEqualTo("PG사는 A사로 확정한다.");
    }

    @Test
    @DisplayName("사내 서식(라벨 칸) 양식을 채운 문서를 섹션으로 나눈다")
    void parse_corporateLabelTemplate_splitsSections() {
        // 실제 양식 .docx를 추출한 결과 형태 그대로다 — 상단 정보란, 라벨 칸, 중첩된 실행항목 표, 하단 결재란.
        String filled = String.join("\n",
            "회 의 록",
            "회의종류", "정기회의", "작성자", "김민준",
            "참석인원", "4명", "참석자", "김민준, 이서연",
            "일시", "2026-08-02", "장소", "회의실 A",
            "회의주제", "결제 모듈 진행 점검",
            "회의안건", "PG사 선정",
            "회의내용",
            "결제 모듈 진행 상황을 공유했다. 일정이 촉박하다는 이야기가 나왔다.",
            "결정사항",
            "PG사는 A사로 확정한다.",
            "실행항목",
            "우선순위",
            "내용 (누가 · 무엇을 · 언제까지)",
            "[v] 긴급 [ ] 보통 [ ] 낮음",
            "김민준이 결제 API 연동을 8/10까지 마무리한다.",
            "[ ] 긴급 [ ] 보통 [ ] 낮음",
            "※ 해당 우선순위의 대괄호 안에 v 를 넣어주세요. 예: [v] 긴급",
            "비고",
            "테스트 계정 발급이 늦어지고 있다.",
            "결재", "팀장", "부서장", "대표"
        );

        MeetingSections sections = MeetingTemplateParser.parse(filled).orElseThrow();

        assertThat(sections.discussion())
            .isEqualTo("결제 모듈 진행 상황을 공유했다. 일정이 촉박하다는 이야기가 나왔다.");
        assertThat(sections.decisions()).isEqualTo("PG사는 A사로 확정한다.");
        assertThat(sections.todos()).contains("[v] 긴급");
        assertThat(sections.todos()).contains("김민준이 결제 API 연동을 8/10까지 마무리한다.");
        assertThat(sections.todos()).doesNotContain("내용 (");
        assertThat(sections.todos()).doesNotContain("※");
        // 하단 결재란은 마지막 섹션(비고) 뒤에 오므로 걸러내지 않으면 리스크 내용에 섞인다.
        assertThat(sections.issues()).isEqualTo("테스트 계정 발급이 늦어지고 있다.");
    }

    @Test
    @DisplayName("상단 정보란의 회의명·일시·참석자는 분석에 쓰지 않는다 — 업로드 모달 입력값이 단일 출처다")
    void parse_corporateTemplate_ignoresHeaderInfo() {
        String filled = String.join("\n",
            "회의종류", "정기회의", "작성자", "김민준",
            "일시", "2026-08-02", "장소", "회의실 A",
            "회의내용", "진행 상황을 공유했다.",
            "결정사항", "일정을 확정했다.",
            "실행항목", "김민준이 문서를 작성한다."
        );

        MeetingSections sections = MeetingTemplateParser.parse(filled).orElseThrow();

        assertThat(sections.discussion()).doesNotContain("회의실 A");
        assertThat(sections.discussion()).doesNotContain("2026-08-02");
        assertThat(sections.discussion()).isEqualTo("진행 상황을 공유했다.");
    }

    @Test
    @DisplayName("빈 텍스트와 null은 양식이 아니다")
    void parse_blankInput_isEmpty() {
        assertThat(MeetingTemplateParser.parse(null)).isEqualTo(Optional.empty());
        assertThat(MeetingTemplateParser.parse("   ")).isEqualTo(Optional.empty());
    }

    @Test
    void 예시_행과_안내_문구는_실행항목으로_잡히지_않는다() {
        String text = String.join("\n",
            "회의내용", "로그인 오류를 논의했다.",
            "결정사항", "원인 파악을 우선한다.",
            "실행항목",
            "우선순위", "내용 (누가 · 무엇을 · 언제까지)",
            "[ ] 긴급    [ ] 보통    [ ] 낮음", "(예시) 박지수 · 로그인 오류 원인 파악 · 8/20",
            "[v] 긴급    [ ] 보통    [ ] 낮음", "유소은 · 세션 만료 확인 · 8/22",
            "※ 항목이 더 필요하면 표에서 행을 추가하세요.",
            "비고", "없음");

        MeetingSections sections = MeetingTemplateParser.parse(text).orElseThrow();

        assertThat(sections.todos()).doesNotContain("(예시)");
        assertThat(sections.todos()).doesNotContain("항목이 더 필요하면");
        assertThat(sections.todos()).contains("유소은 · 세션 만료 확인 · 8/22");
    }
}
