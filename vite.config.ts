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
});
