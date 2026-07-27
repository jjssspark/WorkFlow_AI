import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../../hooks/useAuth";
import { NotificationProvider } from "../../hooks/useNotifications";
import { AppShell } from "./AppShell";

vi.mock("../ui/use-mobile", () => ({ useIsMobile: () => true }));

vi.mock("../../api/notificationApi", () => ({
  fetchUnreadNotificationCount: vi.fn().mockResolvedValue(0),
  subscribeNotificationStream: vi.fn(),
}));

describe("AppShell (mobile)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("hides the sidebar off-screen until the hamburger menu opens it, and closes it again when an item is selected", async () => {
    render(
      <MemoryRouter initialEntries={["/board"]}>
        <AuthProvider>
          <NotificationProvider>
            <AppShell />
          </NotificationProvider>
        </AuthProvider>
      </MemoryRouter>
    );

    const sidebarWrapper = screen.getByText("TeamFlow").closest("[data-sidebar-wrapper]") as HTMLElement;
    expect(sidebarWrapper.className).toContain("-translate-x-full");

    await userEvent.click(screen.getByRole("button", { name: "메뉴 열기" }));
    expect(sidebarWrapper.className).toContain("translate-x-0");

    await userEvent.click(screen.getByRole("button", { name: "대시보드" }));
    expect(sidebarWrapper.className).toContain("-translate-x-full");
  });

  it("removes the off-screen sidebar from the accessibility tree and tab order, and restores it once opened", async () => {
    render(
      <MemoryRouter initialEntries={["/board"]}>
        <AuthProvider>
          <NotificationProvider>
            <AppShell />
          </NotificationProvider>
        </AuthProvider>
      </MemoryRouter>
    );

    const sidebarWrapper = screen.getByText("TeamFlow").closest("[data-sidebar-wrapper]") as HTMLElement;
    expect(sidebarWrapper).toHaveAttribute("aria-hidden", "true");
    expect(sidebarWrapper).toHaveAttribute("inert");

    await userEvent.click(screen.getByRole("button", { name: "메뉴 열기" }));
    expect(sidebarWrapper).not.toHaveAttribute("aria-hidden");
    expect(sidebarWrapper).not.toHaveAttribute("inert");
  });
});
