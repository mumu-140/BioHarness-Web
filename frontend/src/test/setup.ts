import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// jsdom has no measured layout. Keep GraphCanvas's real no-viewport fallback,
// and substitute only the geometry library in DOM tests. Chromium checks the
// actual panel implementation, including pointer and keyboard resizing.
vi.mock("react-resizable-panels", async () => {
  const { createElement } = await import("react");
  return {
    Group: ({ children, className }: { children: React.ReactNode; className?: string }) =>
      createElement("div", { className }, children),
    Panel: ({ children, className }: { children: React.ReactNode; className?: string }) =>
      createElement("div", { className }, children),
    Separator: ({ "aria-label": label, className }: { "aria-label"?: string; className?: string }) =>
      createElement("div", { className, role: "separator", "aria-label": label }),
  };
});

afterEach(() => {
  cleanup();
});
