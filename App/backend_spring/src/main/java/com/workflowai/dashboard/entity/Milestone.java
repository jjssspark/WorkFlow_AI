package com.workflowai.dashboard.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.LocalDate;
import java.time.LocalDateTime;

@Entity
@Table(name = "milestones")
public class Milestone {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "project_id", nullable = false)
    private Long projectId;

    @Column(nullable = false)
    private String title;

    @Column(name = "start_date")
    private LocalDate startDate;

    @Column(name = "due_date")
    private LocalDate dueDate;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    protected Milestone() {
    }

    public Milestone(Long projectId, String title, LocalDate dueDate) {
        this(projectId, title, null, dueDate);
    }

    public Milestone(Long projectId, String title, LocalDate startDate, LocalDate dueDate) {
        this.projectId = projectId;
        this.title = title;
        this.startDate = startDate;
        this.dueDate = dueDate;
        this.createdAt = LocalDateTime.now();
    }

    public Long getId() {
        return id;
    }

    public Long getProjectId() {
        return projectId;
    }

    public String getTitle() {
        return title;
    }

    public LocalDate getStartDate() {
        return startDate;
    }

    public LocalDate getDueDate() {
        return dueDate;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public void update(String title, LocalDate startDate, LocalDate dueDate) {
        if (title != null) {
            this.title = title;
        }
        this.startDate = startDate;
        this.dueDate = dueDate;
    }
}
