package com.workflowai.activity;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ActivityRepository extends JpaRepository<Activity, Long> {
    List<Activity> findTop10ByProjectIdOrderByCreatedAtDesc(Long projectId);

    List<Activity> findTop50ByProjectIdOrderByCreatedAtDesc(Long projectId);

    List<Activity> findByTargetIdOrderByCreatedAtDesc(Long targetId);

    List<Activity> findTop10ByActorIdAndTypeInOrderByCreatedAtDesc(Long actorId, List<String> types);
}
