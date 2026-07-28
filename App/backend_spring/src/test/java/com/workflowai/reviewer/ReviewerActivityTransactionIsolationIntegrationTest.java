package com.workflowai.reviewer;

import static org.assertj.core.api.Assertions.assertThat;

import com.workflowai.project.Project;
import com.workflowai.project.ProjectRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.context.annotation.Import;
import org.springframework.stereotype.Service;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * record()가 호출자의 트랜잭션 안에서 실행될 때(EvaluationScoreController.upsert()처럼 컨트롤러
 * 메서드 자체가 @Transactional인 경우) 기록 실패가 호출자의 본 작업 커밋까지 막지 않는지 검증한다.
 *
 * <p>try/catch만으로는 부족하다 — record()가 REQUIRES_NEW 없이 REQUIRED로 호출자의 트랜잭션에
 * 합류하면, record() 안에서 잡은 예외라도 같은 영속성 컨텍스트/트랜잭션을 오염시켜 호출자의
 * 커밋 자체가 실패할 수 있다. Mockito로 흉내낸 예외는 진짜 EntityManager를 건드리지 않아 이
 * 문제를 재현하지 못하므로, project_id NOT NULL 제약을 실제로 위반시켜 진짜 DB 예외를 낸다.
 */
@DataJpaTest
@Transactional(propagation = Propagation.NOT_SUPPORTED)
@Import({ReviewerActivityService.class, ReviewerActivityTransactionIsolationIntegrationTest.UpsertLikeCaller.class})
@TestPropertySource(properties = {
    "spring.jpa.hibernate.ddl-auto=create-drop",
    "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect",
    "spring.flyway.enabled=false"
})
class ReviewerActivityTransactionIsolationIntegrationTest {

    @Autowired
    private UpsertLikeCaller caller;

    @Autowired
    private ProjectRepository projectRepository;

    /** EvaluationScoreController.upsert()와 같은 모양 - 진짜 JPA 쓰기(본 작업) 이후, 같은 트랜잭션 안에서 record()를 호출한다. */
    @Service
    static class UpsertLikeCaller {
        private final ProjectRepository projectRepository;
        private final ReviewerActivityService reviewerActivityService;

        UpsertLikeCaller(ProjectRepository projectRepository, ReviewerActivityService reviewerActivityService) {
            this.projectRepository = projectRepository;
            this.reviewerActivityService = reviewerActivityService;
        }

        @Transactional
        public void saveThenRecord(String projectTitle, Long userId, Long projectId, ReviewerActivityType type) {
            projectRepository.save(new Project(projectTitle, "캡스톤디자인", null));
            // projectId=null은 reviewer_activities.project_id(NOT NULL)를 위반해 record() 내부에서
            // 진짜 DB 제약 예외를 일으킨다.
            reviewerActivityService.record(userId, projectId, type);
        }
    }

    @Test
    void 기록_실패가_같은_트랜잭션의_본_작업까지_되돌리지_않는다() {
        caller.saveThenRecord("격리 검증 프로젝트", 1L, null, ReviewerActivityType.EVALUATION_SCORE_SAVED);

        assertThat(projectRepository.findAll())
            .extracting(Project::getTitle)
            .contains("격리 검증 프로젝트");
    }
}
