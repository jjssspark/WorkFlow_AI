package com.workflowai.rag;

import com.workflowai.common.ApiResponse;
import com.workflowai.security.CurrentUser;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestClientException;

@Tag(name = "AI RAG 어시스턴트", description = "프로젝트 데이터 기반 RAG 질의응답 API")
@RestController
@RequestMapping("/api/v1/ai/rag")
public class RagController {
    private static final Logger log = LoggerFactory.getLogger(RagController.class);

    // 재작성 프롬프트에 실을 대화 기록의 상한. 무한정 받으면 FastAPI 재작성 LLM 호출이 비대해지고
    // 악의적 대용량 페이로드의 통로가 된다.
    private static final int MAX_HISTORY_MESSAGES = 6;
    private static final int MAX_HISTORY_CONTENT_LENGTH = 1000;
    // 질문에도 같은 상한을 둔다. 임베딩 모델이 어차피 512토큰 근처에서 잘라내므로 그보다 긴
    // 질문은 검색 정확도에 기여하지 못하면서, 재작성 LLM 호출 비용과 프롬프트 크기만 키운다.
    private static final int MAX_QUESTION_LENGTH = 1000;

    private final FastApiRagClient fastApiRagClient;
    private final RagRateLimiter rateLimiter;

    public RagController(FastApiRagClient fastApiRagClient, RagRateLimiter rateLimiter) {
        this.fastApiRagClient = fastApiRagClient;
        this.rateLimiter = rateLimiter;
    }

    @Operation(
        summary = "RAG 질의응답",
        description = "회의록/업무 데이터를 기반으로 한 AI 답변과 출처를 반환합니다. "
            + "프로젝트 단위로 요청 빈도가 제한됩니다."
    )
    @PostMapping("/query")
    @PreAuthorize("@projectAccess.isMember(#request.project_id())")
    public ResponseEntity<ApiResponse<RagQueryResponse>> query(@RequestBody RagQueryRequest request) {
        // 입력 검증은 rate limit 차감보다 먼저 한다. 잘못된 페이로드(빈 질문·비정상 history)만으로
        // 프로젝트 요청 예산을 소진시키지 못하게 한다.
        //
        // 빈/null 질문은 클라이언트 잘못이다. null이면 FastAPI 422 → RestClientException → 503으로
        // 위장되고, 공백이면 무의미한 LLM 호출을 태운다.
        if (request.question() == null || request.question().isBlank()) {
            return ResponseEntity.badRequest()
                .body(ApiResponse.fail("INVALID_QUESTION", "질문을 입력해주세요."));
        }

        if (request.question().length() > MAX_QUESTION_LENGTH) {
            return ResponseEntity.badRequest()
                .body(ApiResponse.fail(
                    "INVALID_QUESTION", "질문은 " + MAX_QUESTION_LENGTH + "자 이하여야 합니다."));
        }

        // null은 히스토리 없음으로 정규화한다. FastAPI history 필드는 리스트를 기대한다.
        List<RagHistoryMessage> history = request.history() == null ? List.of() : request.history();
        if (history.size() > MAX_HISTORY_MESSAGES || history.stream().anyMatch(RagController::isInvalid)) {
            return ResponseEntity.badRequest()
                .body(ApiResponse.fail("INVALID_HISTORY", "대화 기록이 허용 범위를 초과했습니다."));
        }

        if (!rateLimiter.tryAcquire(request.project_id())) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .body(ApiResponse.fail("RATE_LIMITED", "요청이 너무 많습니다. 잠시 후 다시 시도하세요."));
        }

        try {
            // user_id는 요청 바디를 신뢰하지 않고 인증 세션에서 직접 채운다 (본인 아닌 다른 사람의
            // user_id를 흉내내 담당 업무를 조회하는 것을 방지).
            RagQueryRequest authenticatedRequest = new RagQueryRequest(
                request.project_id(), request.question(), CurrentUser.id(), history
            );
            RagQueryResponse response = fastApiRagClient.query(authenticatedRequest);
            return ResponseEntity.ok(ApiResponse.ok(response));
        } catch (RestClientException ex) {
            // FastAPI 연결 실패·타임아웃·비2xx 응답(RestClient의 retrieve()가 던짐) 등 다운스트림 장애만
            // 503으로 눌러 담는다. 여기서 잡히지 않는 예외(우리 쪽 버그)는 GlobalExceptionHandler로 흘려보내
            // 500으로 응답해, "일시 장애"와 "코드 결함"이 같은 503으로 뭉개지지 않게 한다.
            log.warn("RAG 질의 실패: project_id={}", request.project_id(), ex);
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(ApiResponse.fail("RAG_UNAVAILABLE", "일시적으로 답변을 생성할 수 없습니다."));
        }
    }

    // JSON 배열에 null 원소("history":[null,...])가 오면 message 자체가 null이라 필드 역참조가
    // NPE(→500)로 이어진다. FastAPI RagHistoryMessage 스키마(role: Literal["user","assistant"],
    // content: str)와 같은 기준으로 여기서 먼저 거부해 명확한 400을 준다.
    private static boolean isInvalid(RagHistoryMessage message) {
        return message == null
            || message.content() == null
            || message.content().length() > MAX_HISTORY_CONTENT_LENGTH
            || !("user".equals(message.role()) || "assistant".equals(message.role()));
    }
}
