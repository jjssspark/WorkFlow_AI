package com.workflowai.comment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.time.LocalDateTime;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.util.ReflectionTestUtils;

@DataJpaTest
@TestPropertySource(properties = {
    "spring.jpa.hibernate.ddl-auto=create-drop",
    "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect",
    "spring.flyway.enabled=false"
})
class PersonalCommentRepositoryTest {

    @Autowired
    private PersonalCommentRepository personalCommentRepository;

    @PersistenceContext
    private EntityManager entityManager;

    /**
     * ddl-auto=create-drop은 엔티티 매핑에서 스키마를 만들 뿐, V20260728_5 마이그레이션의
     * ux_comments_one_reply_per_parent 부분 유니크 인덱스는 포함하지 않는다(flyway가 이 테스트에서는
     * 꺼져 있다). 인덱스가 실제로 DB 레벨에서 걸러내는지 확인하려면 여기서 같은 제약을 직접 만들어야
     * 한다. H2는 CREATE INDEX에 WHERE(부분 인덱스) 절을 지원하지 않지만, ANSI SQL 표준대로 UNIQUE
     * 인덱스에서 NULL은 서로 다른 값으로 취급해 여러 행이 동시에 NULL parent_id를 가질 수 있다 —
     * 즉 WHERE절 없는 일반 UNIQUE INDEX도 "parent_id가 NULL이 아닌 한 유일"이라는 실제 제약과
     * 동일하게 동작해 이 테스트 목적에는 충분하다. 각 테스트는 트랜잭션으로 감싸여 끝나면 롤백되므로
     * (H2는 DDL도 트랜잭션 대상이다), 테스트마다 새로 만들어도 다음 테스트와 충돌하지 않는다.
     */
    @BeforeEach
    void createUniqueIndexOnParentId() {
        entityManager.createNativeQuery(
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_comments_one_reply_per_parent ON comments(parent_id)"
        ).executeUpdate();
    }

    private PersonalComment save(
        Long projectId, Long targetUserId, Long authorId, String content, Long parentId, LocalDateTime createdAt
    ) {
        PersonalComment comment = new PersonalComment(projectId, "personal", targetUserId, authorId, content, parentId);
        ReflectionTestUtils.setField(comment, "createdAt", createdAt);
        return personalCommentRepository.save(comment);
    }

    @Test
    void findByProjectAndTargetUserReturnsOnlyThatThreadInChronologicalOrder() {
        LocalDateTime base = LocalDateTime.now().minusDays(1);
        save(1L, 10L, 20L, "코멘트1", null, base);
        save(1L, 10L, 10L, "답글1", null, base.plusMinutes(1));
        save(1L, 99L, 20L, "다른 사용자 코멘트", null, base);
        save(2L, 10L, 20L, "다른 프로젝트 코멘트", null, base);

        List<PersonalComment> result = personalCommentRepository
            .findByProjectIdAndTargetTypeAndTargetUserIdOrderByCreatedAtAsc(1L, "personal", 10L);

        assertThat(result).extracting(PersonalComment::getContent).containsExactly("코멘트1", "답글1");
    }

    @Test
    void repliesReferenceTheirParentId() {
        PersonalComment parent = save(1L, 10L, 20L, "원 코멘트", null, LocalDateTime.now().minusMinutes(5));
        save(1L, 10L, 10L, "답글", parent.getId(), LocalDateTime.now());

        List<PersonalComment> result = personalCommentRepository
            .findByProjectIdAndTargetTypeAndTargetUserIdOrderByCreatedAtAsc(1L, "personal", 10L);

        assertThat(result.get(0).getParentId()).isNull();
        assertThat(result.get(1).getParentId()).isEqualTo(parent.getId());
    }

    @Test
    void uniqueIndexRejectsSecondReplyToTheSameParent() {
        PersonalComment parent = save(1L, 10L, 20L, "원 코멘트", null, LocalDateTime.now().minusMinutes(5));
        PersonalComment firstReply = new PersonalComment(1L, "personal", 10L, 10L, "첫 답글", parent.getId());
        personalCommentRepository.saveAndFlush(firstReply);

        PersonalComment secondReply = new PersonalComment(1L, "personal", 10L, 10L, "두 번째 답글", parent.getId());

        // plain save()는 즉시 flush하지 않을 수 있어 제약 위반이 이 시점에 드러나지 않을 수 있다 —
        // saveAndFlush로 강제로 동기 반영시켜야 DB가 실제로 거부하는지 확인할 수 있다.
        assertThatThrownBy(() -> personalCommentRepository.saveAndFlush(secondReply))
            .isInstanceOf(DataIntegrityViolationException.class);
    }
}
