import { apiFetch } from "../../../global/api/apiClient";
import type { UserSummary } from "../../../global/api/authTypes";

export interface UpdateProfileRequest {
  name: string;
  affiliation: string | null;
  field: string[];
  githubUsername: string | null;
}

export async function updateProfile(request: UpdateProfileRequest): Promise<UserSummary> {
  return apiFetch<UserSummary>("/me/profile", {
    method: "PUT",
    body: JSON.stringify(request),
  });
}

export async function uploadAvatar(file: File): Promise<UserSummary> {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<UserSummary>("/me/avatar", {
    method: "POST",
    body: formData,
  });
}
