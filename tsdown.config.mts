import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  sourcemap: false,
  // CJS output is a deliberate deliverable (PKG-04); silence the "prefer ESM" notice.
  checks: { legacyCjs: false },
});
