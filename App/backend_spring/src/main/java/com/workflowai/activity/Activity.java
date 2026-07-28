package com.workflowai.activity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.LocalDateTime;

/**
 * 프로젝트 활동 로그. target_id는 폴리모픽(FK 없음) - 업무(task) id 또는
 * 평가 대상 학생의 user id로 쓴다(EVALUATION_FINALIZED/UNFINALIZED는 특정 학생
 * 대상이 아니므로 null).
 */
@Entity
@Table(name = "activities")
public class Activity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "project_id", nullable = false)
    private Long projectId;

    @Column(name = "actor_id", nullable = false)
    private Long actorId;

    @Column(nullable = false)
    private String type;

    @Column(name = "target_id")
    private Long targetId;

    @Column(nullable = false, columnDefinition = "text")
    private String message;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    protected Activity() {
    }

    public Activity(Long projectId, Long actorId, String type, Long targetId, String message) {
        this.projectId = projectId;
        this.actorId = actorId;
        this.type = type;
        this.targetId = targetId;
        this.message = message;
        this.createdAt = LocalDateTime.now();
    }

    public Long getId() {
        return id;
    }

    public Long getActorId() {
        return actorId;
    }

    public String getType() {
        return type;
    }

    public Long getTargetId() {
        return targetId;
    }

    public String getMessage() {
        return message;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }
}
