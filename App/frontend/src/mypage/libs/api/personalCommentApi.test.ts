import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../../../global/api/apiClient";
import { createPersonalComment, fetchMyPersonalComments, replyToPersonalComment } from "./personalCommentApi";

vi.mock("../../../global/api/apiClient", () => ({
  apiFetch: vi.fn(),
}));

describe("personalCommentApi", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetchMyPersonalComments는 projectId를 쿼리로 붙여 /me/comments를 호출한다", async () => {
    vi.mocked(apiFetch).mockResolvedValue([
      { id: 1, authorId: 20, authorName: "심사자", parentId: null, content: "UI가 좋아요", createdAt: "2026-07-25T05:32:00.000Z" },
    ]);

    const result = await fetchMyPersonalComments(1);

    expect(apiFetch).toHaveBeenCalledWith("/me/comments?projectId=1");
    expect(result).toHaveLength(1);
    expect(result[0].authorName).toBe("심사자");
  });

  it("createPersonalComment는 심사자→팀원 코멘트 생성 엔드포인트를 호출한다", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      id: 2, authorId: 20, authorName: "심사자", parentId: null, content: "잘하고 있어요", createdAt: "2026-07-25T06:00:00.000Z",
    });

    await createPersonalComment(1, 10, "잘하고 있어요");

    expect(apiFetch).toHaveBeenCalledWith("/projects/1/members/10/comments", {
      method: "POST",
      body: JSON.stringify({ content: "잘하고 있어요" }),
    });
  });

  it("replyToPersonalComment는 답글 엔드포인트를 호출한다", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      id: 3, authorId: 10, authorName: "이서연", parentId: 2, content: "감사합니다!", createdAt: "2026-07-25T06:05:00.000Z",
    });

    await replyToPersonalComment(1, 2, "감사합니다!");

    expect(apiFetch).toHaveBeenCalledWith("/projects/1/comments/2/replies", {
      method: "POST",
      body: JSON.stringify({ content: "감사합니다!" }),
    });
  });
});
