// Hand-written CommonJS that sets exports.default but never defines __esModule, so the whole exports object is the component.
"use strict";
const { jsx, jsxs } = require("react/jsx-runtime");
function Welcome({ body }) {
  return jsxs("div", { children: [jsx("h1", { children: "exports-default-no-esmodule" }), jsx("p", { children: body })] });
}
exports.default = Welcome;
