package com.workflowai.meeting;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.LocalDateTime;
import java.util.List;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "meeting_analysis")
public class MeetingAnalysis {

    @Id
    @Column(name = "meeting_id")
    private Long meetingId;

    @Column(columnDefinition = "text")
    private String summary;

    @JdbcTypeCode(SqlTypes.JSON)
    private List<String> decisions;

    @JdbcTypeCode(SqlTypes.JSON)
    private List<String> risks;

    @JdbcTypeCode(SqlTypes.JSON)
    private List<String> keywords;

    @Column(name = "analysis_engine")
    private String analysisEngine;

    /** FastAPI 안에서 실제로 답한 티어. 이 컬럼이 생기기 전에 저장된 행은 null 이다. */
    @Column(name = "analysis_provider")
    private String analysisProvider;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    protected MeetingAnalysis() {
    }

    public MeetingAnalysis(
        Long meetingId,
        String summary,
        List<String> decisions,
        List<String> risks,
        List<String> keywords,
        String analysisEngine,
        String analysisProvider
    ) {
        this.meetingId = meetingId;
        this.summary = summary;
        this.decisions = decisions;
        this.risks = risks;
        this.keywords = keywords;
        this.analysisEngine = analysisEngine;
        this.analysisProvider = analysisProvider;
        this.createdAt = LocalDateTime.now();
    }

    public Long getMeetingId() {
        return meetingId;
    }

    public String getSummary() {
        return summary;
    }

    public List<String> getDecisions() {
        return decisions;
    }

    public List<String> getRisks() {
        return risks;
    }

    public List<String> getKeywords() {
        return keywords;
    }

    public String getAnalysisEngine() {
        return analysisEngine;
    }

    public String getAnalysisProvider() {
        return analysisProvider;
    }
}
