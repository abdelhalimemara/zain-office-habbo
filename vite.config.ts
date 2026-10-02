import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

const SERVER_PORT = Number(process.env.ZAIN_SERVER_PORT ?? 8787);

/** The Cloudflare Tunnel hostname from .zain/tunnel.json, if remote access is set up (the server checks Access tokens). */
function tunnelHosts(): string[] {
  try {
    const { host } = JSON.parse(readFileSync(new URL("./.zain/tunnel.json", import.meta.url), "utf8")) as { host?: string };
    return host ? [host] : [];
  } catch {
    return [];
  }
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@shared": fileURLToPath(new URL("./shared", import.meta.url)) },
  },
  server: {
    port: 5173,
    host: "127.0.0.1",
    allowedHosts: tunnelHosts(),
    proxy: { "/api": `http://127.0.0.1:${SERVER_PORT}` },
    watch: { ignored: ["**/.worktrees/**", "**/.claude-flow/**", "**/.swarm/**"] },
  },
  test: {
    globals: true,
    environment: "node",
    environmentMatchGlobs: [["tests/ui/**", "jsdom"]],
    setupFiles: ["tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
