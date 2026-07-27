package com.workflowai.project;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "projects")
public class Project {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 200)
    private String title;

    @Column(length = 50)
    private String type;

    /** 최종 마감일. */
    private LocalDate deadline;

    @Column(columnDefinition = "TEXT")
    private String description;

    @Column(name = "start_date")
    private LocalDate startDate;

    @Column(name = "mid_check_date")
    private LocalDate midCheckDate;

    @Column(name = "member_limit")
    private Integer memberLimit;

    @Column(name = "deliverables")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<String> deliverables;

    @Column(name = "tech_stack")
    @JdbcTypeCode(SqlTypes.JSON)
    private List<String> techStack;

    @Column(columnDefinition = "TEXT")
    private String goals;

    @Column(name = "invite_code", length = 20)
    private String inviteCode;

    @Column(name = "created_by")
    private Long createdBy;

    @Enumerated(EnumType.STRING)
    @Column(name = "eval_status", nullable = false, length = 20)
    private EvalStatus evalStatus = EvalStatus.PENDING;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    protected Project() {
    }

    public Project(String title, String type, LocalDate deadline, String description) {
        this.title = title;
        this.type = type;
        this.deadline = deadline;
        this.description = description;
    }

    /** deadline 없이 생성하는 편의 생성자 (예: DemoDataService의 데모 시딩). */
    public Project(String title, String type, String description) {
        this(title, type, null, description);
    }

    /** 온보딩 폼으로 생성할 때 쓰는 생성자. */
    public Project(
        String title,
        String type,
        String description,
        LocalDate startDate,
        LocalDate deadline,
        LocalDate midCheckDate,
        Integer memberLimit,
        List<String> deliverables,
        List<String> techStack,
        String goals,
        String inviteCode,
        Long createdBy
    ) {
        this.title = title;
        this.type = type;
        this.description = description;
        this.startDate = startDate;
        this.deadline = deadline;
        this.midCheckDate = midCheckDate;
        this.memberLimit = memberLimit;
        this.deliverables = deliverables;
        this.techStack = techStack;
        this.goals = goals;
        this.inviteCode = inviteCode;
        this.createdBy = createdBy;
    }

    @jakarta.persistence.PrePersist
    void onCreate() {
        LocalDateTime now = LocalDateTime.now();
        this.createdAt = now;
        this.updatedAt = now;
    }

    @jakarta.persistence.PreUpdate
    void onUpdate() {
        this.updatedAt = LocalDateTime.now();
    }

    public Long getId() {
        return id;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getType() {
        return type;
    }

    public void setType(String type) {
        this.type = type;
    }

    public LocalDate getStartDate() {
        return startDate;
    }

    public void setStartDate(LocalDate startDate) {
        this.startDate = startDate;
    }

    public LocalDate getMidCheckDate() {
        return midCheckDate;
    }

    public void setMidCheckDate(LocalDate midCheckDate) {
        this.midCheckDate = midCheckDate;
    }

    public Integer getMemberLimit() {
        return memberLimit;
    }

    public void setMemberLimit(Integer memberLimit) {
        this.memberLimit = memberLimit;
    }

    public List<String> getDeliverables() {
        return deliverables;
    }

    public void setDeliverables(List<String> deliverables) {
        this.deliverables = deliverables;
    }

    public List<String> getTechStack() {
        return techStack;
    }

    public void setTechStack(List<String> techStack) {
        this.techStack = techStack;
    }

    public String getGoals() {
        return goals;
    }

    public void setGoals(String goals) {
        this.goals = goals;
    }

    public String getInviteCode() {
        return inviteCode;
    }

    public Long getCreatedBy() {
        return createdBy;
    }

    public EvalStatus getEvalStatus() {
        return evalStatus;
    }

    public LocalDate getDeadline() {
        return deadline;
    }

    public void setDeadline(LocalDate deadline) {
        this.deadline = deadline;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public void setEvalStatus(EvalStatus evalStatus) {
        this.evalStatus = evalStatus;
    }
}
