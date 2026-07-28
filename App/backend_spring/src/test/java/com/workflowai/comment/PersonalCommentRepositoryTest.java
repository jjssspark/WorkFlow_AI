package com.workflowai.comment;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDateTime;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
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
            .findByProjectIdAndTargetUserIdOrderByCreatedAtAsc(1L, 10L);

        assertThat(result).extracting(PersonalComment::getContent).containsExactly("코멘트1", "답글1");
    }

    @Test
    void repliesReferenceTheirParentId() {
        PersonalComment parent = save(1L, 10L, 20L, "원 코멘트", null, LocalDateTime.now().minusMinutes(5));
        save(1L, 10L, 10L, "답글", parent.getId(), LocalDateTime.now());

        List<PersonalComment> result = personalCommentRepository
            .findByProjectIdAndTargetUserIdOrderByCreatedAtAsc(1L, 10L);

        assertThat(result.get(0).getParentId()).isNull();
        assertThat(result.get(1).getParentId()).isEqualTo(parent.getId());
    }
}
