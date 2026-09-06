import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, render, screen } from "@testing-library/react";

import { SidebarProvider } from "@/components/ui/sidebar";
import { WorkspaceHeader } from "@/components/workspace/workspace-header";

rs.mock("next/navigation", () => ({
  useRouter: () => ({ push: rs.fn(), replace: rs.fn(), refresh: rs.fn() }),
  usePathname: () => "/workspace/chats/new",
}));

rs.mock("@/env", () => ({
  env: { NEXT_PUBLIC_STATIC_WEBSITE_ONLY: "false" },
}));

// Hermetic labels: the assertions are about which entries exist, not about
// how they are worded, so a copy edit must not turn this file red.
rs.mock("@/core/i18n/hooks", () => ({
  useI18n: () => ({
    locale: "en-US",
    changeLocale: rs.fn(),
    t: {
      sidebar: { newChat: "New chat" },
      democracy: { launch: "Democracy" },
      imageGeneration: { launch: "Image" },
    },
  }),
}));

afterEach(() => {
  rs.restoreAllMocks();
  cleanup();
});

function renderHeader() {
  return render(
    <SidebarProvider>
      <WorkspaceHeader />
    </SidebarProvider>,
  );
}

/**
 * The sidebar is the fork's shop window in the app, the way the README's
 * bullet list is outside it, and image generation was deliberately taken out
 * of both: the media tools stay bound and `/workspace/image/new` still
 * renders, but nothing offers the feature to a user whose machine may have no
 * GPU behind it.
 *
 * That is an invariant with a silent broken state. Re-adding the entry — by
 * hand, or by an upstream merge landing on this file — breaks no build, fails
 * no type check, and renders perfectly; it just puts the feature back in the
 * window. So the assertions below are written against the *link target*
 * rather than the label, because a route is what an entry point actually is,
 * and they name the two entries that must survive so that "no image entry"
 * cannot be satisfied by a header that renders nothing at all.
 */
describe("WorkspaceHeader", () => {
  it("offers no route into image generation", () => {
    renderHeader();

    const hrefs = screen
      .getAllByRole("link")
      .map((link) => link.getAttribute("href") ?? "");

    expect(hrefs.some((href) => href.startsWith("/workspace/image"))).toBe(
      false,
    );
  });

  it("still offers New chat and Democracy", () => {
    renderHeader();

    const hrefs = screen
      .getAllByRole("link")
      .map((link) => link.getAttribute("href") ?? "");

    expect(hrefs).toContain("/workspace/chats/new");
    expect(hrefs).toContain("/workspace/democracy/new");
  });
});
