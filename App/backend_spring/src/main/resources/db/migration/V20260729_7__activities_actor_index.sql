-- 심사자 홈의 "최근 심사 활동"과 배정 프로젝트 최근 접속순 정렬이 reviewer_activities(저용량
-- 전용 테이블)에서 activities(업무 변경마다 쌓이는 고용량 공용 테이블)로 옮겨왔는데,
-- 전용 테이블에 있던 (user_id, created_at DESC) 인덱스에 해당하는 것이 activities에는 없다.
-- activities의 인덱스는 idx_activities_target(target_id) 하나뿐이라 아래 두 조회가 모두
-- 순차 스캔으로 떨어진다. 심사자 홈은 로그인할 때마다 두 쿼리를 친다.
--
--   1) ReviewerService.getMyRecentActivities
--      WHERE actor_id = ? AND type IN (...) ORDER BY created_at DESC, id DESC LIMIT 10
--   2) ActivityRepository.findLastProjectAccessByActorId
--      WHERE actor_id = ? AND type = 'PROJECT_ACCESS' GROUP BY project_id
--
-- (actor_id, type) 접두사가 두 쿼리의 필터를 모두 덮고, created_at DESC가 1)의 정렬을 받는다.
-- additive/idempotent.
CREATE INDEX IF NOT EXISTS idx_activities_actor_type_created
    ON activities (actor_id, type, created_at DESC);
