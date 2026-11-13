import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { isValidElement } from "react";
import type { ElementType } from "react";

import { REACT_ADAPTER_ERROR_CODES, ReactAdapterError } from "./adapter.errors";
import { isRecord, quotedTemplateName } from "./template.confine";

export interface LoadedTemplate {
  /** The picked default export, not yet checked. */
  value: unknown;
  /** Own export names of the module record, for error messages. */
  exportNames: string[];
}

// A transpiled module (__esModule marker) or a native module namespace, such as the record require(esm) returns.
function isModuleRecord(mod: unknown): mod is object {
  return (
    isRecord(mod) &&
    ("__esModule" in mod ||
      Object.prototype.toString.call(mod) === "[object Module]")
  );
}

function readDefault(mod: object): unknown {
  return "default" in mod ? mod.default : undefined;
}

function pickDefault(value: unknown): unknown {
  // A default export that is itself an __esModule record (double interop) is unwrapped once.
  return isRecord(value) && "__esModule" in value ? readDefault(value) : value;
}

function namesOf(mod: unknown): string[] {
  if (!isRecord(mod) && typeof mod !== "function") {
    return [];
  }
  return Object.keys(mod).filter(
    (name) => name !== "__esModule" && name !== "module.exports"
  );
}

// Total: the thrown value is the template's, so a Proxy trap or a getter on it can throw, and that must not replace it.
function isRequireEsmError(error: unknown): boolean {
  try {
    if (typeof error !== "object" || error === null || !("code" in error)) {
      return false;
    }
    return (
      error.code === "ERR_REQUIRE_ESM" ||
      error.code === "ERR_REQUIRE_ASYNC_MODULE"
    );
  } catch {
    return false;
  }
}

async function importOrRequire(absolute: string): Promise<LoadedTemplate> {
  try {
    const mod: unknown = createRequire(absolute)(absolute);
    return {
      value: pickDefault(isModuleRecord(mod) ? readDefault(mod) : mod),
      exportNames: namesOf(mod),
    };
  } catch (error) {
    // A .cjs file can never be an ES module, so this error comes from one of its dependencies and import()
    // would evaluate the template's top level a second time before failing again. For .js the format is not
    // reliably knowable here (package "type", syntax detection), so its fallback is knowingly left as is.
    if (!isRequireEsmError(error) || path.extname(absolute) === ".cjs") {
      throw error;
    }
    const ns: unknown = await import(pathToFileURL(absolute).href);
    return {
      value: pickDefault(isRecord(ns) ? readDefault(ns) : undefined),
      exportNames: namesOf(ns),
    };
  }
}

// An absolute path inside text: a drive path (C:\x or C:/x), a UNC path, a file: URL, or a rooted POSIX path
// that starts the text or follows white space, a quote, a parenthesis or an equals sign. Leaning towards a
// false positive is deliberate: the only cost of one is that the message shows the error name instead of its text.
const ABSOLUTE_PATH_IN_TEXT =
  /(?:^|[\s"'(=])(?:[A-Za-z]:[\\/]|\\\\|\/(?=[^\s"'/]))|file:\/\//;

// Duck-typed on purpose: an error from another realm (a vm context, a Jest sandbox) is not an instanceof Error.
function isSyntaxErrorNamingAPath(error: unknown): boolean {
  return (
    isRecord(error) &&
    error["name"] === "SyntaxError" &&
    typeof error["message"] === "string" &&
    ABSOLUTE_PATH_IN_TEXT.test(error["message"])
  );
}

// A cause with a string code shows only the code (Node's own messages embed absolute paths and require stacks).
// A SyntaxError whose message names an absolute path, which is how Node reports a malformed .json dependency
// (no code, the file path in front of the parser's text), shows only its name. Any other cause is quoted.
// Exception to the no-path rule: text thrown by the template or its dependencies is quoted as given and may carry
// an absolute path (for example `new Error("bad config in " + __dirname)`); a coded error and a SyntaxError that
// names a path never do.
// Total: the cause is whatever the template threw, so reading `code`, `name` or `message`, or converting it to a
// string, can throw (a null-prototype object, a throwing getter, a revoked Proxy). Then a fixed text stands in.
function describeCause(error: unknown): string {
  try {
    const code = isRecord(error) ? error["code"] : undefined;
    if (typeof code === "string") {
      return `the error code is ${code}; the underlying error is in cause`;
    }
    if (isSyntaxErrorNamingAPath(error)) {
      return "a SyntaxError; the underlying error is in cause";
    }
    return error instanceof Error ? String(error.message) : String(error);
  } catch {
    return "a value that cannot be described; the underlying error is in cause";
  }
}

// Nothing is cached here: Node does not cache a CommonJS module that threw while loading, so the next send retries it.
// A native ESM module that failed to evaluate stays failed until the process restarts; no retry is added.
export async function loadTemplate(
  file: string,
  template: string
): Promise<LoadedTemplate> {
  // createRequire rejects a relative path, so resolve against process.cwd() first, as 0.2.5 did implicitly.
  const absolute = path.resolve(file);
  try {
    return await importOrRequire(absolute);
  } catch (error) {
    // The whole cause stays on error.cause; see describeCause for what the message shows of it.
    throw new ReactAdapterError(
      REACT_ADAPTER_ERROR_CODES.TEMPLATE_LOAD_FAILED,
      `Template ${quotedTemplateName(template)} failed to load: ${describeCause(error)}. A CommonJS template is loaded again on the next send; a native ESM template that failed to load stays failed until the application restarts.`,
      { template, path: absolute, cause: error }
    );
  }
}

// True for what React can render as an element type: a function, or an exotic component such as memo() or forwardRef().
export function isRenderable(
  value: unknown
): value is ElementType<Record<string, unknown>> {
  if (typeof value === "function") {
    return true;
  }
  // Total: a Proxy default export whose traps throw is not renderable, and describeExport then names it.
  try {
    return (
      isRecord(value) &&
      !isValidElement(value) &&
      "$$typeof" in value &&
      typeof value.$$typeof === "symbol"
    );
  } catch {
    return false;
  }
}

// Says what a rejected default export was, for the INVALID_EXPORT message. Total: the value is the template's,
// and listing the keys of a Proxy can throw.
export function describeExport(
  value: unknown,
  exportNames: readonly string[]
): string {
  try {
    return describeExportValue(value, exportNames);
  } catch {
    return "a value that cannot be described";
  }
}

function describeExportValue(
  value: unknown,
  exportNames: readonly string[]
): string {
  if (value === undefined) {
    return `no default export; the module exports [${exportNames.join(", ")}]`;
  }
  if (value === null) {
    return "null";
  }
  if (isValidElement(value)) {
    return "a React element; export the component itself, not an element such as <Welcome />";
  }
  if (isRecord(value)) {
    const keys = Object.keys(value);
    const found = `an object with keys [${keys.join(", ")}]`;
    return keys.includes("default")
      ? `${found}; exports.default was set without the __esModule marker and is not unwrapped: assign the component to module.exports, or compile with an __esModule marker`
      : found;
  }
  return `a ${typeof value}`;
}
