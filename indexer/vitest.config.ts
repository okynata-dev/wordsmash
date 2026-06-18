import { defineConfig } from "vitest/config";

// node:sqlite is experimental and must be enabled in the worker processes that
// actually run the tests (not just the main vitest process). Use the forks pool
// and pass --experimental-sqlite to each fork. We also tell Vite not to try to
// bundle/transform the built-in `node:sqlite` module.
export default defineConfig({
  ssr: {
    external: ["node:sqlite"],
  },
  test: {
    pool: "forks",
    poolOptions: {
      forks: {
        execArgv: ["--experimental-sqlite"],
      },
    },
    server: {
      deps: {
        external: [/node:sqlite/],
      },
    },
  },
});
