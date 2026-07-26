-- meeting_action_items.created_task_id가 업무를 가리킨 채로 있으면, 그 업무를 지울 때
-- FK 위반(fk_action_items_created_task)으로 삭제 자체가 막힌다 - 회의록 AI로 등록된 업무
-- (회의 결과가 섞인 카드 등)를 지울 수 없는 원인. meeting_id 쪽(fk_action_items_meeting)과
-- 같은 정책으로 맞춰 ON DELETE SET NULL로 바꾼다: 업무가 지워지면 후보 기록은 남기고
-- 연결만 끊는다. 환경마다 기존 제약 이름이 다를 수 있어(fk_action_items_created_task /
-- fk_action_items_task) 둘 다 정리하고 하나로 재생성한다.
-- 원본 정의(02_meeting_ai_additions.sql)는 컬럼을 NULL 허용으로 만들었지만, 이 제약 이름부터
-- 이미 원본과 어긋나 있던 걸 보면 실제 운영 스키마가 그 사이 다른 경로로 드리프트했을 수 있다.
-- meeting_id 쪽을 고칠 때도 FK 전에 먼저 DROP NOT NULL부터 했던 선례(03_preserve_meeting_
-- action_items_on_meeting_delete.sql)를 그대로 따라, 이미 NULL 허용이면 아무 효과 없는
-- 안전한 구문으로 상태를 보장해 둔다.
ALTER TABLE meeting_action_items
    ALTER COLUMN created_task_id DROP NOT NULL;

ALTER TABLE meeting_action_items
    DROP CONSTRAINT IF EXISTS fk_action_items_created_task;

ALTER TABLE meeting_action_items
    DROP CONSTRAINT IF EXISTS fk_action_items_task;

ALTER TABLE meeting_action_items
    ADD CONSTRAINT fk_action_items_created_task
    FOREIGN KEY (created_task_id) REFERENCES tasks(id) ON DELETE SET NULL;
