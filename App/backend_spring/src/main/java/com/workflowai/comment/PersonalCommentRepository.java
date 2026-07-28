package com.workflowai.comment;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PersonalCommentRepository extends JpaRepository<PersonalComment, Long> {
    List<PersonalComment> findByProjectIdAndTargetUserIdOrderByCreatedAtAsc(Long projectId, Long targetUserId);
}
