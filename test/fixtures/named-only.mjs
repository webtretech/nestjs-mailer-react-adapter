// Native ESM template with a named export only and no default export.
import { jsx, jsxs } from "react/jsx-runtime";
export function Welcome({ body }) {
  return jsxs("div", { children: [jsx("h1", { children: "named-only" }), jsx("p", { children: body })] });
}
