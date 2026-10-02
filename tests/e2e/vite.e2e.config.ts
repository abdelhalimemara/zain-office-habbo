import { mergeConfig } from "vite";
import base from "../../vite.config";

/**
 * The project's Vite config with a private dependency cache. node_modules is shared (symlinked) by
 * every worktree and by the live dev server, so the default node_modules/.vite is rewritten whenever
 * any of them re-optimizes; a page served from a cache that changed underneath it fails to load its
 * pre-bundled deps and never mounts the world canvas.
 */
export default mergeConfig(base, {
  cacheDir: process.env.E2E_VITE_CACHE_DIR ?? "node_modules/.vite-e2e",
});
