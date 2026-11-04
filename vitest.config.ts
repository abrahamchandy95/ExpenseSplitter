import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // Default to the fast "node" environment for the 16 pure TypeScript domain/state test files.
    // The 3 React component test files (*.test.tsx) opt into "jsdom" via `// @vitest-environment jsdom`.
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // Runs before each test file
    setupFiles: ["src/test/setup.ts"],
  },
});
