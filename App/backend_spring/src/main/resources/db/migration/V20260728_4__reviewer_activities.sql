-- ============================================================================
-- 심사자 활동 기록(reviewer_activities). additive/idempotent.
--
-- 심사자 홈의 "최근 심사 활동" 카드와 배정 프로젝트 목록의 최근 접속순 정렬에 쓴다.
-- 기존에는 이 데이터를 저장하는 곳이 아예 없어 화면이 목 데이터를 그리고 있었다.
-- PresenceService가 접속을 다루긴 하지만 JVM 메모리에 TTL 40초로만 두므로
-- "지금 접속 중"만 답할 수 있고 "언제 마지막으로 열었는지"는 답할 수 없다.
--
-- activity_type은 애플리케이션의 ReviewerActivityType enum과 1:1로 대응한다.
-- 값 종류가 앞으로 늘어날 수 있어 DB CHECK 제약이 아니라 애플리케이션에서 관리한다.
-- ============================================================================

CREATE TABLE IF NOT EXISTS reviewer_activities (
    id            BIGSERIAL   PRIMARY KEY,
    user_id       BIGINT      NOT NULL,
    project_id    BIGINT      NOT NULL,
    activity_type VARCHAR(40) NOT NULL,
    created_at    TIMESTAMP   NOT NULL DEFAULT now()
);

-- 조회는 항상 "특정 심사자의 최근 활동 N건"이므로 (user_id, created_at DESC)로 덮는다.
CREATE INDEX IF NOT EXISTS idx_reviewer_activities_user_created
    ON reviewer_activities (user_id, created_at DESC);
