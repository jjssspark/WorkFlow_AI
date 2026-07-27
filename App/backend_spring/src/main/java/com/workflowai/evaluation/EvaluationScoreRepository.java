package com.workflowai.evaluation;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface EvaluationScoreRepository extends JpaRepository<EvaluationScore, Long> {
    Optional<EvaluationScore> findByProjectIdAndUserId(Long projectId, Long userId);

    List<EvaluationScore> findAllByProjectId(Long projectId);
}
