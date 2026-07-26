import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
} from "react";

export const FAB_POSITION_KEY = "workflow-ai:assistant-fab-position";

// 버튼 크기(w-14 h-14)와 화면 여백(bottom-6 right-6)의 픽셀값. Tailwind 클래스와 두 군데에
// 나뉘어 있으면 한쪽만 바뀌었을 때 클램프가 실제 버튼과 어긋나므로 여기서만 관리한다.
const FAB_SIZE = 56;
const EDGE_MARGIN = 24;

// 이 거리를 넘겨야 드래그로 인정한다. 없으면 버튼을 옮길 때마다 클릭도 같이 발생해
// 패널이 열린다. 반대로 너무 크게 잡으면 짧게 옮기는 동작이 클릭으로 처리된다.
const DRAG_THRESHOLD = 4;

export type FabSide = "left" | "right";

export interface FabPosition {
  side: FabSide;
  top: number;
}

function clampTop(top: number): number {
  const bottomLimit = window.innerHeight - FAB_SIZE - EDGE_MARGIN;
  // 창이 버튼보다 작으면 bottomLimit이 EDGE_MARGIN보다 작아져 상한이 하한을 밑돈다.
  // 그대로 두면 Math.min이 이겨 버튼이 화면 위로 밀려난다.
  return Math.min(Math.max(top, EDGE_MARGIN), Math.max(EDGE_MARGIN, bottomLimit));
}

function defaultPosition(): FabPosition {
  return { side: "right", top: clampTop(window.innerHeight) };
}

function readStoredPosition(): FabPosition {
  try {
    const raw = window.localStorage.getItem(FAB_POSITION_KEY);
    if (!raw) return defaultPosition();
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return defaultPosition();
    const { side, top } = parsed as Partial<FabPosition>;
    if (side !== "left" && side !== "right") return defaultPosition();
    if (typeof top !== "number" || !Number.isFinite(top)) return defaultPosition();
    // 저장 당시보다 창이 작아졌을 수 있어 복원 시점에도 화면 안으로 되돌린다.
    return { side, top: clampTop(top) };
  } catch {
    // 손상된 값 하나 때문에 버튼이 사라지면 안 되므로 기본 위치로 되돌린다.
    return defaultPosition();
  }
}

function writeStoredPosition(position: FabPosition): void {
  try {
    window.localStorage.setItem(FAB_POSITION_KEY, JSON.stringify(position));
  } catch {
    // 저장 실패는 다음 방문에 기본 위치로 돌아가는 정도의 문제라 화면에 알리지 않는다.
  }
}

interface DraggableFab {
  style: CSSProperties;
  isDragging: boolean;
  handlers: {
    onPointerDown: (event: PointerEvent<HTMLElement>) => void;
    onPointerMove: (event: PointerEvent<HTMLElement>) => void;
    onPointerUp: (event: PointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
    onClick: (event: MouseEvent<HTMLElement>) => void;
  };
}

/**
 * 떠 있는 버튼을 끌어서 좌/우 가장자리에 붙일 수 있게 한다.
 *
 * 좌우는 놓은 지점이 화면 어느 쪽 절반인지로 정해 가장자리에 스냅하고, 세로 위치만
 * 자유롭게 둔다. 자유 배치로 두면 화면 한가운데 남아 보드 카드를 가린다.
 *
 * 마우스와 터치를 한 벌로 처리하려고 포인터 이벤트를 쓴다. 끄는 동안은 left/top이 아니라
 * transform으로 따라다니게 해서 매 프레임 레이아웃을 다시 계산하지 않는다.
 */
export function useDraggableFab(onActivate: () => void): DraggableFab {
  const [position, setPosition] = useState<FabPosition>(readStoredPosition);
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const hasDraggedRef = useRef(false);

  useEffect(() => {
    const pullBackOnScreen = () => setPosition(prev => ({ ...prev, top: clampTop(prev.top) }));
    window.addEventListener("resize", pullBackOnScreen);
    return () => window.removeEventListener("resize", pullBackOnScreen);
  }, []);

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    startRef.current = { x: event.clientX, y: event.clientY };
    hasDraggedRef.current = false;
    // 포인터를 캡처해야 버튼 밖으로 빠르게 끌어도 move/up이 계속 들어온다.
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const start = startRef.current;
    if (!start) return;
    const x = event.clientX - start.x;
    const y = event.clientY - start.y;
    if (!hasDraggedRef.current && Math.hypot(x, y) < DRAG_THRESHOLD) return;
    hasDraggedRef.current = true;
    setOffset({ x, y });
  };

  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    const start = startRef.current;
    startRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setOffset(null);
    if (!start || !hasDraggedRef.current) return;

    const next: FabPosition = {
      side: event.clientX < window.innerWidth / 2 ? "left" : "right",
      top: clampTop(position.top + (event.clientY - start.y)),
    };
    setPosition(next);
    writeStoredPosition(next);
  };

  // 터치 제스처가 취소되면(스크롤로 전환, 통화 수신 등) pointerup이 오지 않는다.
  // 여기서 정리하지 않으면 transform이 붙은 채로 굳고 드래그 흔적도 남는다.
  // 취소는 이동을 확정하지 않으므로 position은 건드리지 않는다.
  const onPointerCancel = () => {
    startRef.current = null;
    hasDraggedRef.current = false;
    setOffset(null);
  };

  const onClick = (event: MouseEvent<HTMLElement>) => {
    // 키보드나 보조기술로 활성화한 click은 detail이 0이다. 이 경우를 통과시키지 않으면
    // 마우스로 버튼을 한 번 옮긴 뒤부터 키보드 사용자가 버튼을 영영 누를 수 없다.
    if (event.detail === 0) {
      hasDraggedRef.current = false;
      onActivate();
      return;
    }
    // 방금 끝난 제스처가 드래그였다면 이 클릭은 이동의 부산물이라 삼킨다. 삼킨 자리에서
    // 바로 흔적을 지운다 - pointerdown에만 맡기면 포인터가 버튼 밖에서 떨어져 click이
    // 오지 않았을 때 그 다음 클릭까지 함께 막힌다.
    if (hasDraggedRef.current) {
      hasDraggedRef.current = false;
      return;
    }
    onActivate();
  };

  const isDragging = offset !== null;
  const style: CSSProperties = {
    top: position.top,
    [position.side]: EDGE_MARGIN,
    transform: offset ? `translate(${offset.x}px, ${offset.y}px)` : undefined,
    // 끄는 동안 transition이 남아 있으면 포인터를 뒤늦게 따라와 끊겨 보인다.
    transition: isDragging ? "none" : undefined,
    // 터치에서 드래그가 페이지 스크롤로 가로채이는 것을 막는다.
    touchAction: "none",
  };

  return {
    style,
    isDragging,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClick },
  };
}
