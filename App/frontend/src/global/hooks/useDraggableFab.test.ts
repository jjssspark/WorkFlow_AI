import { fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FAB_POSITION_KEY, useDraggableFab } from "./useDraggableFab";

// jsdom은 PointerEvent를 구현하지 않는다. 그러면 fireEvent가 일반 Event로 대체해
// clientX/clientY가 사라지고 드래그 거리가 전부 NaN이 된다. MouseEvent를 상속하면
// 좌표는 브라우저와 같은 방식으로 전달된다.
if (typeof window.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    constructor(type: string, params: MouseEventInit & { pointerId?: number } = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
    }
  }
  window.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
}

function TestFab({ onActivate }: { onActivate: () => void }) {
  const { style, handlers } = useDraggableFab(onActivate);
  return createElement("button", { ...handlers, style, "data-testid": "fab" });
}

function renderFab(onActivate = vi.fn()) {
  render(createElement(TestFab, { onActivate }));
  return { button: screen.getByTestId("fab"), onActivate };
}

// jsdom 기본 뷰포트. 여기서 벗어난 좌표를 쓰면 클램프 기대값이 달라진다.
const VIEWPORT_WIDTH = 1024;
const VIEWPORT_HEIGHT = 768;

function drag(button: HTMLElement, to: { x: number; y: number }) {
  fireEvent.pointerDown(button, { pointerId: 1, clientX: 900, clientY: 700 });
  fireEvent.pointerMove(button, { pointerId: 1, clientX: to.x, clientY: to.y });
  fireEvent.pointerUp(button, { pointerId: 1, clientX: to.x, clientY: to.y });
}

describe("useDraggableFab", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.innerWidth = VIEWPORT_WIDTH;
    window.innerHeight = VIEWPORT_HEIGHT;
  });

  it("starts docked to the bottom right corner", () => {
    const { button } = renderFab();

    expect(button.style.right).toBe("24px");
    expect(button.style.left).toBe("");
    expect(button.style.top).toBe("688px");
  });

  it("opens the panel on a click that never crossed the drag threshold", () => {
    const { button, onActivate } = renderFab();

    fireEvent.pointerDown(button, { pointerId: 1, clientX: 900, clientY: 700 });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 902, clientY: 701 });
    fireEvent.pointerUp(button, { pointerId: 1, clientX: 902, clientY: 701 });
    fireEvent.click(button);

    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("does not open the panel when the pointer moved far enough to be a drag", () => {
    const { button, onActivate } = renderFab();

    drag(button, { x: 300, y: 400 });
    fireEvent.click(button);

    expect(onActivate).not.toHaveBeenCalled();
  });

  it("opens the panel again on the click after a drag", () => {
    const { button, onActivate } = renderFab();

    drag(button, { x: 300, y: 400 });
    fireEvent.click(button);
    fireEvent.pointerDown(button, { pointerId: 2, clientX: 100, clientY: 400 });
    fireEvent.pointerUp(button, { pointerId: 2, clientX: 100, clientY: 400 });
    fireEvent.click(button);

    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("snaps to the left edge when released on the left half", () => {
    const { button } = renderFab();

    drag(button, { x: 300, y: 400 });

    expect(button.style.left).toBe("24px");
    expect(button.style.right).toBe("");
  });

  it("stays on the right edge when released on the right half", () => {
    const { button } = renderFab();

    drag(button, { x: 800, y: 400 });

    expect(button.style.right).toBe("24px");
    expect(button.style.left).toBe("");
  });

  it("keeps the vertical travel of the drag", () => {
    const { button } = renderFab();

    // 688에서 시작해 300px 위로 끌면 388이 된다.
    drag(button, { x: 800, y: 400 });

    expect(button.style.top).toBe("388px");
  });

  it("follows the pointer with a transform while dragging", () => {
    const { button } = renderFab();

    fireEvent.pointerDown(button, { pointerId: 1, clientX: 900, clientY: 700 });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 800, clientY: 600 });

    expect(button.style.transform).toBe("translate(-100px, -100px)");
  });

  it("restores the stored position on mount", () => {
    window.localStorage.setItem(FAB_POSITION_KEY, JSON.stringify({ side: "left", top: 120 }));

    const { button } = renderFab();

    expect(button.style.left).toBe("24px");
    expect(button.style.top).toBe("120px");
  });

  it("pulls a stored position that no longer fits the viewport back on screen", () => {
    window.localStorage.setItem(FAB_POSITION_KEY, JSON.stringify({ side: "right", top: 5000 }));

    const { button } = renderFab();

    expect(button.style.top).toBe("688px");
  });

  it("ignores a corrupted stored position instead of crashing", () => {
    window.localStorage.setItem(FAB_POSITION_KEY, "{ not json");

    const { button } = renderFab();

    expect(button.style.right).toBe("24px");
    expect(button.style.top).toBe("688px");
  });

  it("pulls the button back on screen when the window shrinks below it", () => {
    const { button } = renderFab();

    window.innerHeight = 300;
    fireEvent(window, new Event("resize"));

    expect(button.style.top).toBe("220px");
  });
});
