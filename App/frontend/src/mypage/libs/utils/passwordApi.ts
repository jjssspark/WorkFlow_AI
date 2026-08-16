import { apiFetch } from "../../../global/api/apiClient";
import type { AuthTokenResponse } from "../../../global/api/authTypes";

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

/**
 * 대상 계정은 서버가 인증 주체에서 정한다 — 요청에 계정을 실어 보내지 않는다.
 * 성공하면 새 토큰이 돌아온다. 비밀번호를 바꾼 시점 이전에 발급된 토큰은 서버가 거부하므로,
 * 호출한 쪽에서 반드시 이 토큰으로 갈아끼워야 본인 세션이 끊기지 않는다.
 */
export async function changePassword(request: ChangePasswordRequest): Promise<AuthTokenResponse> {
  return apiFetch<AuthTokenResponse>("/me/password", {
    method: "PUT",
    body: JSON.stringify(request),
  });
}
