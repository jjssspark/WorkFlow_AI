ALTER TABLE notifications
    ADD COLUMN IF NOT EXISTS project_id BIGINT;

UPDATE notifications n
SET project_id = t.project_id
FROM tasks t
WHERE n.project_id IS NULL
  AND n.target_type = 'task'
  AND n.target_id = t.id;

UPDATE notifications n
SET project_id = m.project_id
FROM meetings m
WHERE n.project_id IS NULL
  AND n.target_type = 'meeting'
  AND n.target_id = m.id;

UPDATE notifications n
SET project_id = m.project_id
FROM milestones m
WHERE n.project_id IS NULL
  AND n.target_type = 'milestone'
  AND n.target_id = m.id;

UPDATE notifications
SET project_id = target_id
WHERE project_id IS NULL
  AND target_type = 'evaluation';

CREATE INDEX IF NOT EXISTS idx_notifications_user_project_created
    ON notifications (user_id, project_id, created_at DESC);
