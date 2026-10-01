import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

const SERVER_PORT = Number(process.env.ZAIN_SERVER_PORT ?? 8787);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@shared": fileURLToPath(new URL("./shared", import.meta.url)) },
  },
  server: {
    port: 5173,
    host: "127.0.0.1",
    proxy: { "/api": `http://127.0.0.1:${SERVER_PORT}` },
  },
  test: {
    globals: true,
    environment: "node",
    environmentMatchGlobs: [["tests/ui/**", "jsdom"]],
    setupFiles: ["tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
