import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  external: ["react"],
  sourcemap: false,
  clean: true,
  dts: true,
});
