// Native ESM template: a .js file inside a package whose package.json sets type module.
import { jsx, jsxs } from "react/jsx-runtime";
export default function Welcome({ body }) {
  return jsxs("div", { children: [jsx("h1", { children: "esm-pkg-welcome" }), jsx("p", { children: body })] });
}
