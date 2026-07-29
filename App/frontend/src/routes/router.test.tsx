import { act, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { toast } from "sonner";
import { describe, expect, it, vi } from "vitest";
import { routes } from "./router";

vi.mock("../auth/screen/LoginScreen", () => ({ LoginScreen: () => <div>로그인 화면</div> }));
vi.mock("../global/hooks/useAuthGuard", () => ({
  RequireAuth: () => null,
  RequireRole: () => null,
  RequireAdmin: () => null,
}));

/**
 * 밀린 알림 토스트는 로그인 직후(=아직 AppShell 밖인 /login·/projects)에 발행된다.
 * sonner는 Toaster가 떠 있지 않을 때 발행된 토스트를 나중에 다시 보여주지 않으므로,
 * Toaster가 AppShell 안에만 있으면 그 토스트들은 영영 사라진다.
 */
describe("router", () => {
  it("AppShell 밖 경로(/login)에서 발행한 토스트도 화면에 보인다", async () => {
    render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ["/login"] })} />);

    await act(async () => {
      toast.custom(() => <div>밀린 알림</div>);
    });

    expect(await screen.findByText("밀린 알림")).toBeInTheDocument();
  });
});
