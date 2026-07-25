package com.workflowai.user;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "users")
public class User {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 255)
    private String email;

    @Column(nullable = false, length = 100)
    private String name;

    @Column(nullable = false, length = 20)
    private String provider;

    @Column(name = "provider_id", nullable = false, length = 255)
    private String providerId;

    @Column(name = "password_hash", length = 255)
    private String passwordHash;

    @Column(name = "reviewer_status", length = 20)
    private String reviewerStatus;

    @Column(name = "affiliation", length = 100)
    private String affiliation;

    @Column(name = "field_tags", nullable = false)
    @JdbcTypeCode(SqlTypes.JSON)
    private List<String> fieldTags = new ArrayList<>();

    @Column(name = "github_username", length = 100)
    private String githubUsername;

    @Column(name = "profile_image_path", length = 255)
    private String profileImagePath;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    protected User() {
    }

    public User(String email, String name, String provider, String providerId) {
        this.email = email;
        this.name = name;
        this.provider = provider;
        this.providerId = providerId;
    }

    /** 로컬(이메일/비밀번호) 회원가입 계정용. */
    public User(String email, String name, String provider, String providerId, String passwordHash) {
        this(email, name, provider, providerId);
        this.passwordHash = passwordHash;
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

    public String getEmail() {
        return email;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getProvider() {
        return provider;
    }

    public String getProviderId() {
        return providerId;
    }

    public String getPasswordHash() {
        return passwordHash;
    }

    public String getReviewerStatus() {
        return reviewerStatus;
    }

    public void setReviewerStatus(String reviewerStatus) {
        this.reviewerStatus = reviewerStatus;
    }

    public String getAffiliation() {
        return affiliation;
    }

    public void setAffiliation(String affiliation) {
        this.affiliation = affiliation;
    }

    public List<String> getFieldTags() {
        return fieldTags;
    }

    public void setFieldTags(List<String> fieldTags) {
        this.fieldTags = fieldTags;
    }

    public String getGithubUsername() {
        return githubUsername;
    }

    public void setGithubUsername(String githubUsername) {
        this.githubUsername = githubUsername;
    }

    public String getProfileImagePath() {
        return profileImagePath;
    }

    public void setProfileImagePath(String profileImagePath) {
        this.profileImagePath = profileImagePath;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }
}
