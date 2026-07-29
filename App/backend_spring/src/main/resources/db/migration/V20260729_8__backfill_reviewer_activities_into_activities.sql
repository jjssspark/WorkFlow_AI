-- ============================================================================
-- reviewer_activities(구, 전용 테이블) 데이터를 activities(신, 공용 테이블)로 백필한다.
--
-- 배경: PR #466(FS-5 3축 리팩터링)이 dev를 머지해 들어오는 과정에서, "심사자 홈 최근
-- 심사 활동" 기능이 두 브랜치에서 독립적으로 병렬 구현된 사실이 드러났다.
--   - feat/reviewer-activity-log(이미 dev에 머지됨): 전용 테이블 reviewer_activities +
--     ReviewerActivity/ReviewerActivityRepository/ReviewerActivityService.
--   - contribution_score(이 브랜치): 기존 공용 activities 테이블 재사용 +
--     ActivityRepository(document_이은주/superpowers/specs/2026-07-28-reviewer-recent-activity-design.md).
-- 이 PR은 후자를 채택했고, 그 결과 ReviewerActivity 계열 자바 클래스가 이 브랜치에서
-- 사라진다. reviewer_activities 테이블 자체는 이 마이그레이션 이후에도 지우지 않지만
-- (별도 안전장치, 아래 참고), 그 테이블을 읽는 애플리케이션 코드가 없어지므로 그대로
-- 두면 이미 쌓인 기록이 조용히 조회 불가능해진다.
--
-- 실측(2026-07-29, 운영 Supabase): reviewer_activities 46건(EVALUATION_SCORE_SAVED 28,
-- PROJECT_ACCESS 18), 전부 project_id=1/user_id=10. FK 위반(존재하지 않는 user_id/project_id)
-- 없음을 사전 확인.
--
-- 타입 매핑:
--   PROJECT_ACCESS       -> activities.type = 'PROJECT_ACCESS' (신 스키마에 동일 이름으로
--                           이미 존재 - ActivityTypes.PROJECT_ACCESS). target_id는 원래도
--                           특정 대상이 없어 NULL.
--   EVALUATION_SCORE_SAVED -> activities.type = 'REVIEW_COMMENT_SAVED'로 매핑한다. 원본
--                           reviewer_activities에는 "점수를 저장했다"는 사실만 있고, 신
--                           스키마가 구분하는 공개/비공개 전환 여부(CONTRIBUTION_SCORE_
--                           PUBLISHED/UNPUBLISHED, GRADE_PUBLISHED/UNPUBLISHED)나 코멘트
--                           저장 여부를 원본만으로는 복원할 수 없다 - 정보 손실이 있는
--                           근사 매핑임을 명시한다. "심사자가 점수 저장 액션을 했다"는
--                           의미로는 REVIEW_COMMENT_SAVED가 REVIEWER_EVALUATION 목록 중
--                           가장 근접한 라벨이라 이걸 택했다(사용자 확인 완료).
--                           target_id는 원본에 평가 대상 학생 id가 없으므로 NULL로 둔다.
--
-- message는 activities.message(NOT NULL)를 채우기 위해 새로 구성한다 - 원본 테이블에는
-- 사람이 읽을 문구가 없었다(ReviewerActivityType.label()이 애플리케이션 코드에만 있었음,
-- 표시 문구를 DB에 안 남기는 게 원래 설계 의도였다). 과거 기록임을 명시하는 접두사를
-- 붙여, 새로 기록되는 항목과 구분되게 한다.
--
-- reviewer_activities 테이블 자체를 이 마이그레이션에서 DROP하지 않는다. 백필 검증
-- (실제 화면에서 정상 노출되는지) 전에 원본을 지우면 되돌릴 방법이 없다. 삭제는 검증
-- 완료 후 별도 V파일로 진행한다.
-- ============================================================================

INSERT INTO activities (project_id, actor_id, type, target_id, message, created_at)
SELECT
    ra.project_id,
    ra.user_id,
    CASE ra.activity_type
        WHEN 'PROJECT_ACCESS' THEN 'PROJECT_ACCESS'
        WHEN 'EVALUATION_SCORE_SAVED' THEN 'REVIEW_COMMENT_SAVED'
        ELSE ra.activity_type
    END,
    NULL,
    CASE ra.activity_type
        WHEN 'PROJECT_ACCESS' THEN '(과거 기록) 프로젝트에 접속했습니다.'
        WHEN 'EVALUATION_SCORE_SAVED' THEN '(과거 기록) 기여도 점수를 저장했습니다.'
        ELSE '(과거 기록) ' || ra.activity_type
    END,
    ra.created_at
FROM reviewer_activities ra
-- 이미 백필된 적이 있어도(재실행) 같은 project_id/actor_id/type/created_at 조합을
-- 다시 넣지 않는다. created_at까지 맞춰야 서로 다른 두 원본 행을 구분할 수 있다
-- (같은 사람이 같은 프로젝트에서 같은 타입 활동을 여러 번 했을 수 있으므로).
WHERE NOT EXISTS (
    SELECT 1 FROM activities a
    WHERE a.project_id = ra.project_id
      AND a.actor_id = ra.user_id
      AND a.created_at = ra.created_at
      AND a.type = CASE ra.activity_type
          WHEN 'PROJECT_ACCESS' THEN 'PROJECT_ACCESS'
          WHEN 'EVALUATION_SCORE_SAVED' THEN 'REVIEW_COMMENT_SAVED'
          ELSE ra.activity_type
      END
);
