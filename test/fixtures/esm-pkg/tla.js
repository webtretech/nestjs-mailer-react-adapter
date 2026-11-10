// Native ESM template with top-level await: require() throws ERR_REQUIRE_ASYNC_MODULE, so only the import() fallback can load it.
import { jsx, jsxs } from "react/jsx-runtime";
await Promise.resolve();
export default function Welcome({ body }) {
  return jsxs("div", { children: [jsx("h1", { children: "esm-pkg-tla" }), jsx("p", { children: body })] });
}
