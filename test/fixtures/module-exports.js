// Hand-written CommonJS that assigns the component to module.exports, with no __esModule marker.
"use strict";
const { jsx, jsxs } = require("react/jsx-runtime");
function Welcome({ body }) {
  return jsxs("div", { children: [jsx("h1", { children: "module-exports" }), jsx("p", { children: body })] });
}
module.exports = Welcome;
