import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const sharedSrc = path.resolve(dir, "../shared/src");
const sharedRoot = path.resolve(dir, "../shared");

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@shared": sharedSrc,
      "@shared-root": sharedRoot,
      "@": path.resolve(dir, "src"),
    },
  },
  server: {
    fs: {
      // /shared lives outside the web root; allow importing its source + json fixtures.
      allow: [dir, sharedRoot],
    },
  },
});
