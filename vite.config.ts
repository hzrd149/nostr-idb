import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

// https://vitejs.dev/config/
export default defineConfig({
  root: "examples",
  base: "/nostr-idb",
  plugins: [svelte()],
  build: {
    outDir: "../public",
    target: "es2022",
  },
});
