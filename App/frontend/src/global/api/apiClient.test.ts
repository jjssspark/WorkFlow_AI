import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch, ApiRequestError } from "./apiClient";
import { tokenStore } from "./tokenStore";

/**
 * 2026-07-23 운영 장애 회귀 테스트.
 *
 * 배포 중 Spring 컨테이너가 교체되는 약 20초 동안 nginx가 백엔드에 붙지 못해 502를 반환했다.
 * 이 응답은 nginx가 만드는 HTML이라 앱의 JSON 규격이 아니고, 그 결과 사용자에게
 * "요청에 실패했습니다."라는 아무 정보 없는 폴백 문구가 표시됐다. 재시도하면 되는
 * 상황인데 영구적인 실패로 오인된다.
 *
 * 게이트웨이 계열(502/503/504)은 "일시적이며 재시도하면 된다"는 것이 사용자에게
 * 전달돼야 한다.
 */

/** 배포 중 nginx가 실제로 반환한 응답을 그대로 재현한다 (Content-Type: text/html). */
function nginxGatewayResponse(status: number): Response {
  return new Response(
    "<html>\r\n<head><title>502 Bad Gateway</title></head>\r\n<body>\r\n<center><h1>502 Bad Gateway</h1></center>\r\n</body>\r\n</html>",
    { status, headers: { "Content-Type": "text/html" } },
  );
}

function jsonEnvelopeResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("apiFetch 오류 메시지", () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([502, 503, 504])(
    "%i 게이트웨이 오류는 재시도 가능함을 알리는 메시지를 준다",
    async (status) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(nginxGatewayResponse(status)));

      const error = (await apiFetch("/auth/test-login", { method: "POST" }).catch((e) => e)) as ApiRequestError;

      expect(error).toBeInstanceOf(ApiRequestError);
      expect(error.status).toBe(status);
      expect(error.code).toBe("SERVICE_UNAVAILABLE");
      expect(error.message).toContain("잠시 후 다시 시도");
      expect(error.message).not.toBe("요청에 실패했습니다.");
    },
  );

  it("서버가 보낸 에러 메시지가 있으면 그대로 전달한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonEnvelopeResponse(409, {
          success: false,
          data: null,
          error: { code: "TEST_ACCOUNT_ALREADY_ACTIVE", message: "현재 이 계정은 다른 곳에서 로그인 중입니다." },
        }),
      ),
    );

    const error = (await apiFetch("/auth/test-login", { method: "POST" }).catch((e) => e)) as ApiRequestError;

    expect(error.message).toBe("현재 이 계정은 다른 곳에서 로그인 중입니다.");
    expect(error.code).toBe("TEST_ACCOUNT_ALREADY_ACTIVE");
  });

  it("500은 게이트웨이 오류와 구분해 기존 폴백을 유지한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(nginxGatewayResponse(500)));

    const error = (await apiFetch("/me").catch((e) => e)) as ApiRequestError;

    expect(error.message).toBe("요청에 실패했습니다.");
  });

  it("404는 기존 문구를 유지한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(nginxGatewayResponse(404)));

    const error = (await apiFetch("/me").catch((e) => e)) as ApiRequestError;

    expect(error.message).toBe("요청한 항목을 찾을 수 없습니다.");
  });
});

describe("apiFetch timeoutMs", () => {
  beforeEach(() => {
    tokenStore.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("응답이 timeoutMs 내에 오지 않으면 요청을 중단하고 타임아웃 오류를 던진다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        const signal = init.signal as AbortSignal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        });
      }),
    );

    const error = (await apiFetch("/projects/1/meetings/1", { method: "DELETE" }, true, 20).catch((e) => e)) as ApiRequestError;

    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error.code).toBe("REQUEST_TIMEOUT");
  });

  it("timeoutMs를 지정하지 않으면 요청을 중단하지 않는다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonEnvelopeResponse(200, { success: true, data: null })));

    await expect(apiFetch("/me")).resolves.toBeNull();
  });
});
