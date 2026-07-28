import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CommentDetailModal } from "./CommentDetailModal";

describe("CommentDetailModal", () => {
  it("제목/작성자/날짜/본문을 보여준다", () => {
    render(
      <CommentDetailModal
        data={{ title: "심사자 코멘트", author: "심사자", dateLabel: "2026-07-25 14:32", content: "UI가 깔끔하네요" }}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole("dialog", { name: "심사자 코멘트" })).toBeInTheDocument();
    expect(screen.getByText(/심사자.*·/)).toBeInTheDocument();
    expect(screen.getByText(/2026-07-25 14:32/)).toBeInTheDocument();
    expect(screen.getByText("UI가 깔끔하네요")).toBeInTheDocument();
  });

  it("dateLabel이 없으면 날짜 없이 작성자만 보여준다", () => {
    render(
      <CommentDetailModal data={{ title: "심사자 코멘트", author: "심사자", content: "잘하고 있습니다." }} onClose={vi.fn()} />
    );

    expect(screen.getByText("잘하고 있습니다.")).toBeInTheDocument();
  });

  it("답글이 있으면 답글도 함께 보여준다", () => {
    render(
      <CommentDetailModal
        data={{
          title: "심사자 코멘트", author: "심사자", dateLabel: "2026-07-25 14:32", content: "UI가 깔끔하네요",
          reply: { author: "이서연", dateLabel: "2026-07-25 15:01", content: "감사합니다!" },
        }}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText(/이서연/)).toBeInTheDocument();
    expect(screen.getByText("감사합니다!")).toBeInTheDocument();
  });

  it("닫기 버튼이나 바깥 영역을 클릭하면 onClose가 호출된다", async () => {
    const onClose = vi.fn();
    render(
      <CommentDetailModal data={{ title: "심사자 코멘트", author: "심사자", content: "내용" }} onClose={onClose} />
    );

    await userEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("팝업 내부(본문)를 클릭해도 닫히지 않는다", async () => {
    const onClose = vi.fn();
    render(
      <CommentDetailModal data={{ title: "심사자 코멘트", author: "심사자", content: "내용" }} onClose={onClose} />
    );

    await userEvent.click(screen.getByText("내용"));
    expect(onClose).not.toHaveBeenCalled();
  });
});
