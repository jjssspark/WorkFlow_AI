import { tokenStore } from "./tokenStore";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080/api/v1";

export const AUTH_LOGOUT_EVENT = "workflow-ai:auth-logout";

export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string } | null;
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

/** 백엔드에 도달하지 못했거나 백엔드가 일시적으로 처리할 수 없는 상태 — 재시도가 의미 있다. */
const GATEWAY_STATUSES = new Set([502, 503, 504]);

let refreshPromise: Promise<boolean> | null = null;

async function readJsonEnvelope<T>(response: Response): Promise<ApiEnvelope<T> | null> {
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) return null;
  try {
    return (await response.json()) as ApiEnvelope<T>;
  } catch {
    return null;
  }
}

async function refreshTokens(): Promise<boolean> {
  const refreshToken = tokenStore.getRefreshToken();
  if (!refreshToken) return false;
  try {
    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as ApiEnvelope<{ accessToken: string; refreshToken: string }>;
    if (!body.success) return false;
    tokenStore.setTokens(body.data.accessToken, body.data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  retry = true,
  timeoutMs?: number
): Promise<T> {
  const accessToken = tokenStore.getAccessToken();
  const testSessionId = tokenStore.getTestSessionId();
  const headers = new Headers(options.headers);
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  if (testSessionId) headers.set("X-Workflow-Test-Session-Id", testSessionId);
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const timeoutController = timeoutMs ? new AbortController() : null;
  const timeoutId = timeoutController ? setTimeout(() => timeoutController.abort(), timeoutMs) : null;

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers,
      signal: timeoutController?.signal ?? options.signal,
    });
  } catch (error) {
    if (timeoutController?.signal.aborted) {
      throw new ApiRequestError("요청이 너무 오래 걸려 중단되었습니다. 잠시 후 다시 시도해주세요.", 0, "REQUEST_TIMEOUT");
    }
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  if (response.status === 401 && retry && accessToken) {
    if (!refreshPromise) {
      refreshPromise = refreshTokens().finally(() => {
        refreshPromise = null;
      });
    }
    const refreshed = await refreshPromise;
    if (refreshed) {
      return apiFetch<T>(path, options, false, timeoutMs);
    }
    throw new ApiRequestError("인증이 만료되었습니다. 다시 로그인해주세요.", 401, "UNAUTHORIZED");
  }

  const body = await readJsonEnvelope<T>(response);
  if (!response.ok) {
    // 배포로 백엔드 컨테이너가 교체되는 동안 nginx가 502를 반환한다(2026-07-23 운영 사례).
    // 이때 응답은 nginx가 만드는 HTML이라 error.message가 없어 일반 폴백 문구가 나가는데,
    // 재시도하면 되는 상황이 영구적인 실패로 오인된다. 일시적임을 명시한다.
    if (GATEWAY_STATUSES.has(response.status)) {
      throw new ApiRequestError(
        body?.error?.message ?? "서버가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해주세요.",
        response.status,
        body?.error?.code ?? "SERVICE_UNAVAILABLE"
      );
    }
    const message = body?.error?.message ?? (response.status === 404 ? "요청한 항목을 찾을 수 없습니다." : "요청에 실패했습니다.");
    throw new ApiRequestError(message, response.status, body?.error?.code);
  }
  if (!body) {
    throw new ApiRequestError("서버 응답을 읽을 수 없습니다.", response.status);
  }
  if (!body.success) {
    throw new ApiRequestError(body.error?.message ?? "요청에 실패했습니다.", response.status, body.error?.code);
  }
  return body.data;
}
