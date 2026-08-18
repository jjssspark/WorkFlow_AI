package com.workflowai.meeting;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

@Component
public class FallbackMeetingAnalyzer {
    private static final List<Pattern> ASSIGNEE_PATTERNS = List.of(
        Pattern.compile("^([가-힣]{2,4})(?:은|는|이|가)\\s"),
        Pattern.compile("담당[:\\s]+([가-힣]{2,4})")
    );
    /** "이름: 발언" 형식의 화자 줄(회의록 전사 포맷)을 인식한다. */
    private static final Pattern SPEAKER_LINE_PATTERN = Pattern.compile("^([가-힣]{2,4})\\s*[:：]\\s*(.+)$");
    private static final List<String> TASK_KEYWORDS =
        List.of("담당", "작성", "구현", "정리", "검토", "준비", "연결", "테스트", "맡", "잡", "만들", "보여주", "설계", "추출");
    private static final List<String> FORMAL_TASK_KEYWORDS = List.of(
        "확인", "점검", "검토", "정리", "작성", "구현", "개선", "연결", "테스트",
        "표시", "반영", "처리", "준비", "설계", "추출", "관리", "삭제", "등록"
    );
    private static final List<String> FORMAL_TASK_HINTS = List.of(
        "다음 회의 전까지", "전까지", "점검한다", "확인한다", "검토한다", "정리한다",
        "작성한다", "구현한다", "개선한다", "확인해보겠다고", "점검해보겠다고", "검토해보겠다고"
    );
    private static final List<String> DATE_CONTEXT_KEYWORDS =
        List.of("까지", "전까지", "마감", "완료", "제출", "기한", "추후", "일정");
    private static final Pattern DATEISH_PATTERN = Pattern.compile(
        "20\\d{2}\\s*(?:[-./]|년\\s*)\\s*\\d{1,2}\\s*(?:[-./]|월\\s*)\\s*\\d{1,2}\\s*일?"
            + "|(?<!\\d)\\d{1,2}\\s*[./]\\s*\\d{1,2}(?!\\d)"
            + "|\\d{1,2}\\s*월\\s*\\d{1,2}\\s*일"
    );
    private static final int SPEAKER_TASK_LIMIT = 12;

    public MeetingAnalysisResult analyze(AiAnalyzeRequest request) {
        List<String> participants = safeParticipants(request.participants());
        String title = blankToDefault(request.title(), "회의록 AI 분석 회의");
        String date = blankToDefault(request.meeting_date(), LocalDate.now().toString());
        String text = blankToDefault(request.text(), title + " 회의 내용");

        List<String> decisions = extractSentences(text, List.of("확정", "결정", "통일", "진행", "사용"), 5);
        if (decisions.isEmpty()) {
            decisions = List.of(
                "회의록 분석 결과는 요약, 결정사항, To-Do, 위험요소 형식으로 정리한다.",
                "생성된 To-Do는 팀장 검토 후 업무 보드에 등록한다."
            );
        }

        List<String> risks = extractSentences(text, List.of("위험", "지연", "부족", "오류", "실패", "불안정"), 4);
        if (risks.isEmpty()) {
            risks = List.of("담당자와 마감일이 명확하지 않은 업무는 일정 지연으로 이어질 수 있다.");
        }

        List<MeetingTodo> todos = buildTodos(text, date, participants);
        String summary = "%s에서 논의된 내용을 분석해 핵심 결정사항 %d건, To-Do %d건, 위험요소 %d건을 추출했다."
            .formatted(title, decisions.size(), todos.size(), risks.size());

        return new MeetingAnalysisResult(
            summary,
            decisions,
            todos,
            risks,
            keywords(text, request.source_type()),
            new MeetingMeta(title, date, participants),
            "spring_fallback"
        );
    }

    private List<MeetingTodo> buildTodos(String text, String date, List<String> participants) {
        List<String[]> candidates = extractExplicitTaskCandidates(text);
        if (candidates.isEmpty()) {
            List<String> taskSentences = extractSentences(text, List.of("담당", "작성", "구현", "정리", "검토", "준비", "연결", "테스트"), 6);
            if (taskSentences.isEmpty()) {
                taskSentences = List.of(
                    "회의록 AI 분석 API 구현",
                    "분석 결과 화면과 업무 보드 등록 흐름 연결",
                    "팀장 검토용 To-Do 승인 화면 점검"
                );
            }
            candidates = taskSentences.stream().map(sentence -> new String[] { extractAssigneeCandidate(sentence), sentence }).toList();
        }

        List<MeetingTodo> todos = new ArrayList<>();
        Set<String> allowedNames = new LinkedHashSet<>(participants);
        for (int i = 0; i < candidates.size(); i++) {
            String assignee = candidates.get(i)[0];
            String sentence = candidates.get(i)[1];
            if (assignee != null && !assignee.isBlank() && !allowedNames.isEmpty() && !allowedNames.contains(assignee)) {
                assignee = "";
            }
            String evidenceText = assignee != null && !assignee.isBlank() ? assignee + ": " + sentence : sentence;
            todos.add(new MeetingTodo(
                shorten(cleanTodoTitle(sentence), 42),
                sentence,
                assignee,
                null,
                extractDueDateCandidate(sentence, date),
                i < 2 ? "HIGH" : "MEDIUM",
                inferCategory(sentence),
                true,
                evidenceText
            ));
        }
        return todos;
    }

    /**
     * "이름: 발언" 형식의 회의록 전사에서, 화자가 직접 담당을 언급한 문장만 (화자 이름, 문장) 쌍으로 추출한다.
     * 화자 줄이 전혀 없는 텍스트(전사 포맷이 아닌 경우)에는 빈 리스트를 반환해 기존 키워드 추출로 대체한다.
     */
    private List<String[]> extractSpeakerTaskCandidates(String text) {
        List<String[]> found = new ArrayList<>();
        for (String line : text.split("\\n")) {
            String trimmed = line.trim();
            if (trimmed.isEmpty()) continue;
            Matcher speakerMatcher = SPEAKER_LINE_PATTERN.matcher(trimmed);
            if (!speakerMatcher.matches()) continue;
            String speaker = speakerMatcher.group(1);
            String utterance = speakerMatcher.group(2);
            for (String sentence : utterance.split("[.!?。！？]")) {
                String s = sentence.trim();
                if (s.length() < 4) continue;
                boolean isCommitment = s.contains("겠습니다") || TASK_KEYWORDS.stream().anyMatch(s::contains);
                if (isCommitment) {
                    found.add(new String[] { speaker, shorten(s, 120) });
                }
                if (found.size() >= SPEAKER_TASK_LIMIT) return found;
            }
        }
        return found;
    }

    private List<String[]> extractFormalTaskCandidates(String text) {
        String followup = extractFollowupSection(text);
        List<String[]> found = extractNamedActionClauses(followup.isBlank() ? text : followup, !followup.isBlank());
        if (!found.isEmpty()) return found.size() > SPEAKER_TASK_LIMIT ? found.subList(0, SPEAKER_TASK_LIMIT) : found;
        if (!followup.isBlank()) return List.of();

        List<String[]> fallback = new ArrayList<>();
        for (String sentence : text.split("[\\n.。!?！？]")) {
            String trimmed = sentence.trim();
            if (trimmed.length() < 6) continue;
            if (FORMAL_TASK_HINTS.stream().noneMatch(trimmed::contains)) continue;
            fallback.addAll(extractNamedActionClauses(trimmed, false));
            if (fallback.size() >= SPEAKER_TASK_LIMIT) break;
        }
        return fallback.size() > SPEAKER_TASK_LIMIT ? fallback.subList(0, SPEAKER_TASK_LIMIT) : fallback;
    }

    private List<String[]> extractExplicitTaskCandidates(String text) {
        List<String[]> speakerCandidates = extractSpeakerTaskCandidates(text);
        if (!speakerCandidates.isEmpty()) return speakerCandidates;
        return extractFormalTaskCandidates(text);
    }

    private String extractFollowupSection(String text) {
        Matcher matcher = Pattern.compile("추후\\s*일정\\s*[:：]?\\s*(.+)", Pattern.DOTALL).matcher(text);
        if (!matcher.find()) return "";
        String section = matcher.group(1);
        return section.split("\\n\\s*(작성자|특이\\s*사항|안건|논의\\s*내용)\\s*[:：]?", 2)[0].trim();
    }

    private List<String[]> extractNamedActionClauses(String text, boolean trustFollowupSection) {
        List<String[]> found = new ArrayList<>();
        Pattern pattern = Pattern.compile("([가-힣]{2,4})(?:은|는|이|가)\\s+");
        Matcher matcher = pattern.matcher(text);
        List<MatcherSnapshot> matches = new ArrayList<>();
        while (matcher.find()) {
            matches.add(new MatcherSnapshot(matcher.group(1), matcher.start(), matcher.end()));
        }
        for (int i = 0; i < matches.size(); i++) {
            MatcherSnapshot match = matches.get(i);
            int end = i + 1 < matches.size() ? matches.get(i + 1).start() : text.length();
            String clause = text.substring(match.end(), end).trim().replaceAll("^[,\\s.]+|[,\\s.]+$", "");
            clause = clause.split("[.。!?！？]\\s*", 2)[0].trim().replaceAll("^[,\\s.]+|[,\\s.]+$", "");
            if (clause.isBlank()) continue;
            if (FORMAL_TASK_KEYWORDS.stream().noneMatch(clause::contains)) continue;
            String prefix = text.substring(Math.max(0, match.start() - 20), match.start());
            boolean hasHint = FORMAL_TASK_HINTS.stream().anyMatch(clause::contains)
                || prefix.contains("전까지")
                || prefix.contains("추후");
            if (!trustFollowupSection && !hasHint) continue;
            found.add(new String[] { match.name(), shorten(clause, 120) });
            if (found.size() >= SPEAKER_TASK_LIMIT) break;
        }
        return found;
    }

    /** 문장에서 "OO가/은/는 ~한다" 또는 "담당: OO" 형태로 적힌 담당자 이름을 추출한다. 없으면 빈 문자열(미배정 후보). */
    private String extractAssigneeCandidate(String sentence) {
        String trimmed = sentence.trim();
        for (Pattern pattern : ASSIGNEE_PATTERNS) {
            Matcher matcher = pattern.matcher(trimmed);
            if (matcher.find()) {
                return matcher.group(1);
            }
        }
        return "";
    }

    private String extractDueDateCandidate(String sentence, String meetingDate) {
        Matcher matcher = DATEISH_PATTERN.matcher(sentence);
        while (matcher.find()) {
            if (!hasDateContext(sentence, matcher.start(), matcher.end())) continue;
            String normalized = normalizeDateToken(matcher.group(), meetingDate);
            if (normalized != null) return normalized;
        }
        return null;
    }

    private boolean hasDateContext(String text, int start, int end) {
        String context = text.substring(Math.max(0, start - 24), Math.min(text.length(), end + 24));
        return DATE_CONTEXT_KEYWORDS.stream().anyMatch(context::contains);
    }

    private String normalizeDateToken(String token, String meetingDate) {
        String trimmed = token.trim();
        Matcher full = Pattern.compile("^(20\\d{2})\\s*(?:[-./]|년\\s*)\\s*(\\d{1,2})\\s*(?:[-./]|월\\s*)\\s*(\\d{1,2})\\s*일?$")
            .matcher(trimmed);
        if (full.matches()) {
            return safeDate(Integer.parseInt(full.group(1)), Integer.parseInt(full.group(2)), Integer.parseInt(full.group(3)));
        }
        Matcher compact = Pattern.compile("^(\\d{1,2})\\s*[./]\\s*(\\d{1,2})$").matcher(trimmed);
        if (compact.matches()) {
            return safeDate(meetingYear(meetingDate), Integer.parseInt(compact.group(1)), Integer.parseInt(compact.group(2)));
        }
        Matcher korean = Pattern.compile("^(\\d{1,2})\\s*월\\s*(\\d{1,2})\\s*일$").matcher(trimmed);
        if (korean.matches()) {
            return safeDate(meetingYear(meetingDate), Integer.parseInt(korean.group(1)), Integer.parseInt(korean.group(2)));
        }
        return null;
    }

    private int meetingYear(String meetingDate) {
        try {
            return LocalDate.parse(meetingDate).getYear();
        } catch (RuntimeException ignored) {
            return LocalDate.now().getYear();
        }
    }

    private String safeDate(int year, int month, int day) {
        try {
            return LocalDate.of(year, month, day).toString();
        } catch (RuntimeException ignored) {
            return null;
        }
    }

    private String cleanTodoTitle(String sentence) {
        String title = sentence.trim().replaceAll("[.!?~。！？]+$", "");
        title = title.replaceFirst("^(저는|제가|우선|먼저)\\s+", "");
        title = title.replaceFirst("^[가-힣]{2,4}(?:은|는|이|가)\\s+", "");
        title = title.replaceFirst("^다음 회의 전까지\\s+", "");
        title = title.replaceAll("(을|를)\\s+(확인|점검|검토|정리|작성|구현|개선|연결|테스트|표시|반영|처리|준비|설계)(하고|한다|하였다|하겠다|하겠습니다|해보겠다고 말했다)?\\s*$", " $2");
        for (String suffix : List.of(
            "해보겠다고 말했다", "하겠다고 말했다", "진행하겠습니다", "구현하겠습니다", "정리하겠습니다",
            "작성하겠습니다", "만들겠습니다", "보여주겠습니다", "잡겠습니다", "맡겠습니다",
            "하겠습니다", "겠습니다", "확인하고", "점검하고", "검토하고", "확인한다", "점검한다", "검토한다"
        )) {
            if (title.endsWith(suffix)) {
                title = title.substring(0, title.length() - suffix.length()).trim();
                break;
            }
        }
        title = title.replaceAll("(을|를)\\s+(확인|점검|검토|정리|작성|구현|개선|연결|테스트|표시|반영|처리|준비|설계)\\s*$", " $2");
        return title.isBlank() ? sentence.trim() : title;
    }

    private List<String> extractSentences(String text, List<String> keywords, int limit) {
        List<String> found = new ArrayList<>();
        for (String sentence : text.split("[\\n.。!?！？]")) {
            String trimmed = sentence.trim();
            if (trimmed.length() < 6) continue;
            for (String keyword : keywords) {
                if (trimmed.contains(keyword)) {
                    found.add(shorten(trimmed, 120));
                    break;
                }
            }
            if (found.size() >= limit) break;
        }
        return found;
    }

    private String inferCategory(String sentence) {
        String lower = sentence.toLowerCase();
        if (lower.contains("api") || sentence.contains("백엔드") || sentence.contains("서버")) return "BACKEND";
        if (sentence.contains("화면") || sentence.contains("UI") || sentence.contains("프론트")) return "FRONTEND";
        if (sentence.contains("모델") || sentence.contains("AI") || sentence.contains("분석")) return "AI";
        if (sentence.contains("테스트") || sentence.contains("검수")) return "QA";
        if (sentence.contains("발표") || sentence.contains("PPT")) return "PRESENTATION";
        if (sentence.contains("문서") || sentence.contains("보고서")) return "DOCUMENT";
        return "ETC";
    }

    private List<String> keywords(String text, String sourceType) {
        Set<String> keywords = new LinkedHashSet<>();
        keywords.add("회의록 AI");
        keywords.add(sourceType == null ? "문서 업로드" : sourceType);
        for (String candidate : List.of("Spring Boot", "FastAPI", "To-Do", "업무 보드", "대시보드", "기여도", "해커톤", "공모전", "캡스톤")) {
            if (text.contains(candidate)) keywords.add(candidate);
        }
        return new ArrayList<>(keywords);
    }

    private List<String> safeParticipants(List<String> participants) {
        if (participants == null) return List.of();
        return participants.stream().filter(p -> p != null && !p.isBlank()).toList();
    }

    private String blankToDefault(String value, String defaultValue) {
        return value == null || value.isBlank() ? defaultValue : value;
    }

    private String shorten(String value, int max) {
        return value.length() <= max ? value : value.substring(0, max - 1) + "…";
    }

    private record MatcherSnapshot(String name, int start, int end) {}
}
