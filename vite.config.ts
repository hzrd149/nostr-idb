import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  root: "examples",
  base: "/",
  plugins: [react()],
  resolve: {
    alias: {
      // allow examples to import from src/ without building first
      "nostr-idb": path.resolve(__dirname, "src/index.ts"),
    },
  },
  build: {
    target: "es2022",
  },
  worker: {
    // the snort worker-relay worker uses code splitting
    format: "es",
  },
  optimizeDeps: {
    // sqlite-wasm loads its .wasm relative to its own module, which breaks
    // when pre-bundled
    exclude: ["@sqlite.org/sqlite-wasm"],
    // the worker-relay worker is loaded from source, so pre-bundle its
    // CommonJS dependencies for dev
    include: [
      "@snort/worker-relay > eventemitter3",
      "@snort/worker-relay > uuid",
    ],
  },
});
