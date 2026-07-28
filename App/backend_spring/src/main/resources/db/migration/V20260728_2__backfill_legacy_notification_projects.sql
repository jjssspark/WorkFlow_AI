-- V20260728_1에서 원본 target을 통해 복원하지 못한 과거 알림을 추가로 분류한다.
-- 잘못된 프로젝트에 알림을 귀속시키는 것보다 NULL을 유지하는 편이 안전하므로,
-- 아래의 결정 가능한 경우에만 project_id를 채운다.

-- target_type='project'인 알림은 target_id 자체가 project_id다.
UPDATE notifications
SET project_id = target_id
WHERE project_id IS NULL
  AND target_type = 'project'
  AND target_id IS NOT NULL;

-- 알림 생성 당시 가입해 있던 프로젝트가 정확히 하나였으면 해당 프로젝트로 안전하게 역산할 수 있다.
UPDATE notifications n
SET project_id = candidate.project_id
FROM (
    SELECT n2.id AS notification_id, MIN(pm.project_id) AS project_id
    FROM notifications n2
    JOIN project_members pm
      ON pm.user_id = n2.user_id
     AND pm.created_at <= n2.created_at
    WHERE n2.project_id IS NULL
    GROUP BY n2.id
    HAVING COUNT(DISTINCT pm.project_id) = 1
) candidate
WHERE n.id = candidate.notification_id
  AND n.project_id IS NULL;

-- 가입 시각 정보만으로 판단할 수 없더라도 현재 소속 프로젝트가 하나뿐이면 오귀속 가능성이 없다.
UPDATE notifications n
SET project_id = candidate.project_id
FROM (
    SELECT n2.id AS notification_id, MIN(pm.project_id) AS project_id
    FROM notifications n2
    JOIN project_members pm ON pm.user_id = n2.user_id
    WHERE n2.project_id IS NULL
    GROUP BY n2.id
    HAVING COUNT(DISTINCT pm.project_id) = 1
) candidate
WHERE n.id = candidate.notification_id
  AND n.project_id IS NULL;

-- 여러 프로젝트 중 어느 것인지 결정할 근거가 없는 행은 NULL로 보존한다.
-- 임의 귀속하면 다른 프로젝트 화면에 잘못된 알림을 노출하므로 삭제하거나 추정하지 않는다.
