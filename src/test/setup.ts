import { afterEach } from "vitest";

// Only load heavy DOM testing libraries when running in a browser-like test environment
if (typeof window !== "undefined") {
  await import("@testing-library/jest-dom/vitest");
  const { cleanup } = await import("@testing-library/react");
  afterEach(() => {
    cleanup();
  });
}
