package com.workflowai.task;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Map;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "tasks")
public class Task {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "project_id", nullable = false)
    private Long projectId;

    @Column(name = "milestone_id")
    private Long milestoneId;

    @Column(nullable = false)
    private String title;

    @Column(nullable = false)
    private String category;

    @Column(nullable = false)
    private String status;

    @Column(name = "assignee_id")
    private Long assigneeId;

    @Column(name = "start_date")
    private LocalDate startDate;

    @Column(name = "due_date")
    private LocalDate dueDate;

    private String priority;

    @Column(columnDefinition = "text")
    private String description;

    @Column(name = "source_type")
    private String sourceType;

    @Column(name = "source_meeting_id")
    private Long sourceMeetingId;

    @Column(name = "created_by")
    private Long createdBy;

    @Column(nullable = false)
    private double position;

    @Column(name = "pending_approval", nullable = false)
    private boolean pendingApproval;

    // 카테고리별 추가 정보(자유 키-값). Hibernate 6 내장 JSON 매핑으로 별도 라이브러리 없이 JSONB에 저장한다.
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "extra_fields", columnDefinition = "jsonb")
    private Map<String, String> extraFields;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    protected Task() {
    }

    public Task(
        Long projectId,
        String title,
        String category,
        String status,
        Long assigneeId,
        LocalDate dueDate,
        String priority,
        String description,
        String sourceType,
        Long sourceMeetingId,
        Long createdBy,
        double position
    ) {
        this(projectId, null, title, category, status, assigneeId, null, dueDate, priority,
            description, sourceType, sourceMeetingId, createdBy, position);
    }

    public Task(
        Long projectId,
        Long milestoneId,
        String title,
        String category,
        String status,
        Long assigneeId,
        LocalDate startDate,
        LocalDate dueDate,
        String priority,
        String description,
        String sourceType,
        Long sourceMeetingId,
        Long createdBy,
        double position
    ) {
        this.projectId = projectId;
        this.milestoneId = milestoneId;
        this.title = title;
        this.category = category;
        this.status = status;
        this.assigneeId = assigneeId;
        this.startDate = startDate;
        this.dueDate = dueDate;
        this.priority = priority;
        this.description = description;
        this.sourceType = sourceType;
        this.sourceMeetingId = sourceMeetingId;
        this.createdBy = createdBy;
        this.position = position;
        this.createdAt = LocalDateTime.now();
        this.updatedAt = LocalDateTime.now();
    }

    public Long getId() {
        return id;
    }

    public Long getProjectId() {
        return projectId;
    }

    public Long getMilestoneId() {
        return milestoneId;
    }

    public String getTitle() {
        return title;
    }

    public String getCategory() {
        return category;
    }

    public String getStatus() {
        return status;
    }

    public Long getAssigneeId() {
        return assigneeId;
    }

    public LocalDate getStartDate() {
        return startDate;
    }

    public void setStartDate(LocalDate startDate) {
        this.startDate = startDate;
    }

    public LocalDate getDueDate() {
        return dueDate;
    }

    public String getPriority() {
        return priority;
    }

    public String getDescription() {
        return description;
    }

    public String getSourceType() {
        return sourceType;
    }

    public Long getSourceMeetingId() {
        return sourceMeetingId;
    }

    public Long getCreatedBy() {
        return createdBy;
    }

    public double getPosition() {
        return position;
    }

    public boolean isPendingApproval() {
        return pendingApproval;
    }

    public Map<String, String> getExtraFields() {
        return extraFields;
    }

    public void setExtraFields(Map<String, String> extraFields) {
        this.extraFields = extraFields;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    /** 칸반 드래그앤드롭: 카드를 다른 컬럼/다른 위치로 옮긴다. */
    public void moveTo(String status, double position) {
        this.status = status;
        this.position = position;
    }

    /** 팀원이 완료 승인을 요청한다. status는 그대로 두고 대기 상태만 켠다. */
    public void requestCompletion() {
        this.pendingApproval = true;
    }

    /** 담당자가 본인이 올린 완료 승인 요청을 취소한다. */
    public void cancelCompletionRequest() {
        this.pendingApproval = false;
    }

    /** 팀장이 완료를 승인한다 — 실제로 완료 컬럼 맨 끝으로 옮긴다. */
    public void approveCompletion(double position) {
        this.status = "done";
        this.position = position;
        this.pendingApproval = false;
    }

    /** 팀장이 완료를 반려한다 — status는 그대로 두고 대기 상태만 끈다. */
    public void rejectCompletion() {
        this.pendingApproval = false;
    }

    public void moveToMilestone(Long milestoneId) {
        this.milestoneId = milestoneId;
    }

    public void updatePlanningDates(LocalDate startDate, LocalDate dueDate) {
        this.startDate = startDate;
        this.dueDate = dueDate;
    }

    /**
     * null인 필드는 변경하지 않는다(부분 수정). updated_at은 DB 트리거(trg_tasks_updated_at)가 갱신한다.
     * 담당자 미배정/마감일 삭제처럼 "명시적으로 null로 비우기"는 아직 어떤 프론트 화면에서도 호출하지 않으므로 지원하지 않는다.
     */
    public void applyUpdate(
        String title, String category, Long assigneeId, LocalDate startDate, LocalDate dueDate, String priority,
        String description, Map<String, String> extraFields
    ) {
        if (title != null) this.title = title;
        if (category != null) this.category = category;
        if (assigneeId != null) this.assigneeId = assigneeId;
        if (startDate != null) this.startDate = startDate;
        if (dueDate != null) this.dueDate = dueDate;
        if (priority != null) this.priority = priority;
        if (description != null) this.description = description;
        if (extraFields != null) this.extraFields = extraFields;
    }
}
