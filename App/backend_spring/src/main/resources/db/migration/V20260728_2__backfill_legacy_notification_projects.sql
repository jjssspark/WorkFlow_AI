-- V20260728_1에서 원본 target을 통해 복원하지 못한 과거 알림을 추가로 분류한다.
-- 잘못된 프로젝트에 알림을 귀속시키는 것보다 NULL을 유지하는 편이 안전하므로,
-- 아래의 결정 가능한 경우에만 project_id를 채운다.

-- target_type='project'인 알림은 target_id 자체가 project_id다.
UPDATE notifications
SET project_id = target_id
WHERE project_id IS NULL
  AND target_type = 'project'
  AND target_id IS NOT NULL;

-- project_members는 탈퇴 이력을 보존하지 않으므로 현재/생성 당시 소속 프로젝트 수만으로는
-- 과거 알림의 프로젝트를 안전하게 추론할 수 없다. 원본 target으로 확정할 수 없는 행은
-- NULL로 보존하며, 임의 귀속하거나 삭제하지 않는다.
