import { defineConfig } from "vite";
import { resolve } from "path";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// https://vitejs.dev/config/
export default defineConfig({
  root: "examples",
  base: "/nostr-idb",
  plugins: [svelte()],
  build: {
    outDir: "../public",
    target: "es2022",
    rollupOptions: {
      input: {
        local: resolve(__dirname, "examples/basic/index.html"),
        "nostr-tools": resolve(__dirname, "examples/nostr-tools/index.html"),
      },
    },
  },
});
