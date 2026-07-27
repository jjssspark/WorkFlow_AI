import { apiFetch } from "./apiClient";

export interface EvaluationScoreDto {
  projectId: number;
  userId: number;
  // AI가 산정한 기여 점수(기여도 분석 화면 왼쪽 테이블 값). 학점 계산기의 총합(totalScore)과는
  // 별개 필드다 — 과거엔 하나의 필드를 공유해서 학점 계산기 저장 시 기여 점수가 총합으로
  // 덮어써지는 버그가 있었다(코드 리뷰로 발견, 2026-07-24).
  score: number;
  totalScore: number | null;
  contributionPublic: boolean;
  finalPublic: boolean;
  commentPublic: boolean;
  reviewerScore: number | null;
  grade: string | null;
  comment: string | null;
}

// upsertEvaluationScore에 전달할 값들 — score/totalScore/contributionPublic/finalPublic/
// commentPublic/reviewerScore/grade/comment는 모두 생략(undefined)하면 서버가 기존 값을
// 그대로 유지한다. 세 공개 플래그(contributionPublic/finalPublic/commentPublic)는 서로
// 독립적으로 토글되므로, 한쪽 화면의 토글이 다른 화면이 저장한 값이나 공개 상태를
// 덮어쓰지 않도록 건드릴 필드만 넘긴다. 학점 계산기 저장은 반드시 totalScore만 채우고
// score(AI 기여 점수)는 건드리지 않는다.
export interface EvaluationScoreUpdate {
  score?: number;
  totalScore?: number;
  contributionPublic?: boolean;
  finalPublic?: boolean;
  commentPublic?: boolean;
  reviewerScore?: number;
  grade?: string;
  comment?: string;
}

/** 심사자가 팀원 최종 평가 점수/공개 여부/코멘트를 확정하거나 토글할 때 호출한다. 심사자만 호출 가능. */
export function upsertEvaluationScore(projectId: number, userId: number, update: EvaluationScoreUpdate) {
  return apiFetch<EvaluationScoreDto>(`/projects/${projectId}/evaluations`, {
    method: "POST",
    body: JSON.stringify({
      projectId,
      userId,
      score: update.score ?? null,
      totalScore: update.totalScore ?? null,
      contributionPublic: update.contributionPublic ?? null,
      finalPublic: update.finalPublic ?? null,
      commentPublic: update.commentPublic ?? null,
      reviewerScore: update.reviewerScore ?? null,
      grade: update.grade ?? null,
      comment: update.comment ?? null,
    }),
  });
}

/** 심사자 화면에서 현재 공개/비공개 상태를 조회할 때 사용한다. 심사자만 호출 가능. */
export function getEvaluationScores(projectId: number) {
  return apiFetch<EvaluationScoreDto[]>(`/projects/${projectId}/evaluations`);
}

export interface EvaluationSettingDto {
  projectId: number;
  contributionRatio: number;
}

/** 학점 계산기의 기여 점수 반영 비율(%)을 조회한다. 저장한 적 없으면 기본값(40%)을 반환한다. 심사자만 호출 가능. */
export function getEvaluationSettings(projectId: number) {
  return apiFetch<EvaluationSettingDto>(`/projects/${projectId}/evaluation-settings`);
}

/** 학점 계산기의 기여 점수 반영 비율(%)을 저장한다. 프로젝트 공통 값으로 upsert된다. 심사자만 호출 가능. */
export function upsertEvaluationSettings(projectId: number, contributionRatio: number) {
  return apiFetch<EvaluationSettingDto>(`/projects/${projectId}/evaluation-settings`, {
    method: "PUT",
    body: JSON.stringify({ contributionRatio }),
  });
}

export interface MyEvaluationDto {
  contributionRevealed: boolean;
  score: number | null;
  finalRevealed: boolean;
  totalScore: number | null;
  reviewerScore: number | null;
  grade: string | null;
  commentRevealed: boolean;
  comment: string | null;
}

/**
 * 마이페이지에서 로그인한 본인의 공개된 평가 결과를 조회한다. 기여 점수/총합·학점/심사 코멘트는
 * 서로 독립적으로 공개되므로, 각 revealed 플래그를 개별로 확인해야 한다.
 */
export function getMyEvaluation(projectId: number) {
  return apiFetch<MyEvaluationDto>(`/projects/${projectId}/evaluations/me`);
}
