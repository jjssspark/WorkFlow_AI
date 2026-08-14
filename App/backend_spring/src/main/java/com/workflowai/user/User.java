package com.workflowai.user;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
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

    @Enumerated(EnumType.STRING)
    @Column(name = "reviewer_status", length = 20)
    private ReviewerStatus reviewerStatus;

    @Column(name = "affiliation", length = 100)
    private String affiliation;

    @Column(name = "is_admin", nullable = false)
    private boolean admin = false;

    @Column(name = "faculty_id", length = 50)
    private String facultyId;

    @Column(name = "reviewer_rejection_reason", length = 500)
    private String reviewerRejectionReason;

    @Column(name = "field_tags", nullable = false)
    @JdbcTypeCode(SqlTypes.JSON)
    private List<String> fieldTags = new ArrayList<>();

    @Column(name = "github_username", length = 100)
    private String githubUsername;

    @Column(name = "profile_image_path", length = 255)
    private String profileImagePath;

    @Column(name = "terms_agreed_at")
    private LocalDateTime termsAgreedAt;

    @Column(name = "privacy_agreed_at")
    private LocalDateTime privacyAgreedAt;

    /** 비밀번호를 실제로 바꾼 시각. updatedAt과 달리 명시적으로만 세팅되며, 리프레시 토큰 무효화 판단에 쓴다. */
    @Column(name = "password_changed_at")
    private LocalDateTime passwordChangedAt;

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

    public void setPasswordHash(String passwordHash) {
        this.passwordHash = passwordHash;
    }

    public ReviewerStatus getReviewerStatus() {
        return reviewerStatus;
    }

    public void setReviewerStatus(ReviewerStatus reviewerStatus) {
        this.reviewerStatus = reviewerStatus;
    }

    public String getAffiliation() {
        return affiliation;
    }

    public void setAffiliation(String affiliation) {
        this.affiliation = affiliation;
    }

    public boolean isAdmin() {
        return admin;
    }

    public void setAdmin(boolean admin) {
        this.admin = admin;
    }

    public String getFacultyId() {
        return facultyId;
    }

    public void setFacultyId(String facultyId) {
        this.facultyId = facultyId;
    }

    public String getReviewerRejectionReason() {
        return reviewerRejectionReason;
    }

    public void setReviewerRejectionReason(String reviewerRejectionReason) {
        this.reviewerRejectionReason = reviewerRejectionReason;
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

    public LocalDateTime getTermsAgreedAt() {
        return termsAgreedAt;
    }

    public void setTermsAgreedAt(LocalDateTime termsAgreedAt) {
        this.termsAgreedAt = termsAgreedAt;
    }

    public LocalDateTime getPrivacyAgreedAt() {
        return privacyAgreedAt;
    }

    public void setPrivacyAgreedAt(LocalDateTime privacyAgreedAt) {
        this.privacyAgreedAt = privacyAgreedAt;
    }

    public LocalDateTime getPasswordChangedAt() {
        return passwordChangedAt;
    }

    public void setPasswordChangedAt(LocalDateTime passwordChangedAt) {
        this.passwordChangedAt = passwordChangedAt;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }
}
