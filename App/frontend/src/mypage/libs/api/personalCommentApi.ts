import { apiFetch } from "../../../global/api/apiClient";

export interface PersonalCommentDto {
  id: number;
  authorId: number;
  authorName: string;
  parentId: number | null;
  content: string;
  createdAt: string; // ISO-8601
}

/** 마이페이지 "개인 코멘트/피드백"에 표시할, 로그인한 본인이 받은 코멘트+답글 목록(최대 10건, 시간순). */
export function fetchMyPersonalComments(projectId: number): Promise<PersonalCommentDto[]> {
  return apiFetch<PersonalCommentDto[]>(`/me/comments?projectId=${projectId}`);
}

/** 심사자가 프로젝트 내 특정 팀원에게 새 코멘트를 남긴다. 심사자만 호출 가능. */
export function createPersonalComment(
  projectId: number, targetUserId: number, content: string
): Promise<PersonalCommentDto> {
  return apiFetch<PersonalCommentDto>(`/projects/${projectId}/members/${targetUserId}/comments`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

/** 코멘트를 받은 팀원 본인이 답글을 남긴다. 이미 답글인 코멘트에는 답글을 달 수 없다. */
export function replyToPersonalComment(
  projectId: number, commentId: number, content: string
): Promise<PersonalCommentDto> {
  return apiFetch<PersonalCommentDto>(`/projects/${projectId}/comments/${commentId}/replies`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}
