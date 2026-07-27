package com.workflowai.task;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.LocalDateTime;

/** storagePath는 S3 호환 스토리지 버킷(workflow.storage.bucket) 하위 object 경로. */
@Entity
@Table(name = "task_result_files")
public class TaskResultFile {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "task_id", nullable = false)
    private Long taskId;

    @Column(name = "file_name", nullable = false, length = 255)
    private String fileName;

    @Column(name = "storage_path", nullable = false, columnDefinition = "text")
    private String storagePath;

    @Column(nullable = false)
    private long size;

    @Column(name = "content_type", length = 100)
    private String contentType;

    @Column(name = "uploaded_by")
    private Long uploadedBy;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    protected TaskResultFile() {
    }

    public TaskResultFile(Long taskId, String fileName, String storagePath, long size, String contentType, Long uploadedBy) {
        this.taskId = taskId;
        this.fileName = fileName;
        this.storagePath = storagePath;
        this.size = size;
        this.contentType = contentType;
        this.uploadedBy = uploadedBy;
        this.createdAt = LocalDateTime.now();
    }

    public Long getId() {
        return id;
    }

    public Long getTaskId() {
        return taskId;
    }

    public String getFileName() {
        return fileName;
    }

    public String getStoragePath() {
        return storagePath;
    }

    public long getSize() {
        return size;
    }

    public String getContentType() {
        return contentType;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }
}
