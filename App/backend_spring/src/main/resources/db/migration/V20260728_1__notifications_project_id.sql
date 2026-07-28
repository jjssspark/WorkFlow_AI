-- 알림에 프로젝트 개념이 없어서, 여러 프로젝트에 참여하는 사용자에게 모든 프로젝트의 알림이
-- 섞여서 전달됐다. project_id로 알림을 프로젝트 단위로 격리한다.
--
-- NOT NULL을 걸지 않는 이유: 아래 백필로 복원할 수 없는 과거 행(target_id가 NULL인
-- 진행률 보고서 알림 등)이 남는다. 모든 조회 경로가 project_id = :projectId 조건을 가지므로
-- NULL 행은 어떤 화면에도 나타나지 않는다.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS project_id BIGINT;

-- target_type/target_id로 원본 테이블을 역추적해 기존 알림의 project_id를 복원한다.
UPDATE notifications n SET project_id = t.project_id
  FROM tasks t
 WHERE n.target_type = 'task' AND n.target_id = t.id AND n.project_id IS NULL;

-- 회의록 버전(MEETING_EDITED 알림의 target_id)도 meetings 테이블의 행이므로 이 문으로 함께 복원된다.
UPDATE notifications n SET project_id = m.project_id
  FROM meetings m
 WHERE n.target_type = 'meeting' AND n.target_id = m.id AND n.project_id IS NULL;

UPDATE notifications n SET project_id = ms.project_id
  FROM milestones ms
 WHERE n.target_type = 'milestone' AND n.target_id = ms.id AND n.project_id IS NULL;

-- evaluation 알림은 target_id에 이미 project_id가 들어 있다(EvaluationScoreController 참조).
UPDATE notifications SET project_id = target_id
 WHERE target_type = 'evaluation' AND target_id IS NOT NULL AND project_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_user_project_created
    ON notifications (user_id, project_id, created_at DESC);
