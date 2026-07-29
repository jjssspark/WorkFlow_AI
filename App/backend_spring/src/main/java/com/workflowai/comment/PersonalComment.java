package com.workflowai.comment;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.LocalDateTime;

@Entity
@Table(name = "comments")
public class PersonalComment {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "project_id", nullable = false)
    private Long projectId;

    @Column(name = "target_type", nullable = false, length = 10)
    private String targetType;

    @Column(name = "target_user_id")
    private Long targetUserId;

    @Column(name = "author_id", nullable = false)
    private Long authorId;

    @Column(nullable = false, columnDefinition = "text")
    private String content;

    @Column(name = "parent_id")
    private Long parentId;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    protected PersonalComment() {
    }

    public PersonalComment(
        Long projectId, String targetType, Long targetUserId, Long authorId, String content, Long parentId
    ) {
        this.projectId = projectId;
        this.targetType = targetType;
        this.targetUserId = targetUserId;
        this.authorId = authorId;
        this.content = content;
        this.parentId = parentId;
        this.createdAt = LocalDateTime.now();
    }

    public Long getId() {
        return id;
    }

    public Long getProjectId() {
        return projectId;
    }

    public String getTargetType() {
        return targetType;
    }

    public Long getTargetUserId() {
        return targetUserId;
    }

    public Long getAuthorId() {
        return authorId;
    }

    public String getContent() {
        return content;
    }

    public Long getParentId() {
        return parentId;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }
}
