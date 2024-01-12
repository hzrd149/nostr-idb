import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// https://vitejs.dev/config/
export default defineConfig({
  root: "example",
  base: "/nostr-idb",
  plugins: [react()],
  build: {
    target: "es2022",
  },
});
