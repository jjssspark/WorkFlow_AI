-- 칸반 이동(TaskController.updatePosition)마다 증가하는 업무별 카운터.
-- 실시간 동기화(TaskMoveEvent)가 SSE 도착 순서와 무관하게 최신 상태를 가려낼 근거로 쓴다.
-- epoch millis 같은 벽시계 값은 동률(OS 타이머 해상도)과 시스템 시계 보정 시 역행 가능성이
-- 있어 순서를 보장하지 못하므로, DB에 저장되는 정수 카운터로 대체한다.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS move_version BIGINT NOT NULL DEFAULT 0;
