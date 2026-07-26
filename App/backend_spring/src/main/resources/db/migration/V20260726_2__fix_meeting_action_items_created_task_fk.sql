-- meeting_action_items.created_task_id가 업무를 가리킨 채로 있으면, 그 업무를 지울 때
-- FK 위반(fk_action_items_created_task)으로 삭제 자체가 막힌다 - 회의록 AI로 등록된 업무
-- (회의 결과가 섞인 카드 등)를 지울 수 없는 원인. meeting_id 쪽(fk_action_items_meeting)과
-- 같은 정책으로 맞춰 ON DELETE SET NULL로 바꾼다: 업무가 지워지면 후보 기록은 남기고
-- 연결만 끊는다. 환경마다 기존 제약 이름이 다를 수 있어(fk_action_items_created_task /
-- fk_action_items_task) 둘 다 정리하고 하나로 재생성한다.
ALTER TABLE meeting_action_items
    DROP CONSTRAINT IF EXISTS fk_action_items_created_task;

ALTER TABLE meeting_action_items
    DROP CONSTRAINT IF EXISTS fk_action_items_task;

ALTER TABLE meeting_action_items
    ADD CONSTRAINT fk_action_items_created_task
    FOREIGN KEY (created_task_id) REFERENCES tasks(id) ON DELETE SET NULL;
