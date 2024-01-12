import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// https://vitejs.dev/config/
export default defineConfig({
  root: "example",
  plugins: [react()],
  build: {
    target: "es2022",
  },
});
