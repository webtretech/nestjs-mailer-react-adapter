// Native ESM template with top-level await: require() rejects it, so only the import() fallback can load it.
import { jsx, jsxs } from "react/jsx-runtime";
const body = await Promise.resolve("Body");
export default function Welcome() {
  return jsxs("div", { children: [jsx("h1", { children: "tla-fallback" }), jsx("p", { children: body })] });
}
