import { build } from "esbuild";

await build({
  entryPoints: ["./src/worker/worker.ts"],
  bundle: true,
  outfile: "./dist/worker/worker.js",
  target: "es2020",
  minify: true,
  sourcemap: true,
  external: [],
});

await build({
  entryPoints: ["./src/worker/shared.ts"],
  bundle: true,
  outfile: "./dist/worker/shared.js",
  target: "es2020",
  minify: true,
  sourcemap: true,
  external: [],
});
