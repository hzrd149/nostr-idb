import resolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import commonjs from "@rollup/plugin-commonjs";

export default [
  {
    input: "src/worker/worker.ts",
    plugins: [commonjs(), resolve(), typescript({ declaration: false })],
    output: [{ file: "./dist/worker/worker.js", format: "es" }],
  },
  {
    input: "src/worker/shared.ts",
    plugins: [commonjs(), resolve(), typescript({ declaration: false })],
    output: [{ file: "./dist/worker/shared.js", format: "es" }],
  },
];
