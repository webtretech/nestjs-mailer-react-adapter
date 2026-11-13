// Native ESM template: an .mjs file with a default export.
import { jsx, jsxs } from "react/jsx-runtime";
export default function Welcome({ body }) {
  return jsxs("div", { children: [jsx("h1", { children: "esm-mjs" }), jsx("p", { children: body })] });
}
