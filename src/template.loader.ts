import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { isValidElement } from "react";
import type { ElementType } from "react";

import { REACT_ADAPTER_ERROR_CODES, ReactAdapterError } from "./adapter.errors";

export interface LoadedTemplate {
  /** The picked default export, not yet checked. */
  value: unknown;
  /** Own export names of the module record, for error messages. */
  exportNames: string[];
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

// A transpiled module (__esModule marker) or a native module namespace, such as the record require(esm) returns.
function isModuleRecord(mod: unknown): mod is object {
  return (
    isObject(mod) &&
    ("__esModule" in mod ||
      Object.prototype.toString.call(mod) === "[object Module]")
  );
}

function readDefault(mod: object): unknown {
  return "default" in mod ? mod.default : undefined;
}

function pickDefault(value: unknown): unknown {
  // A default export that is itself an __esModule record (double interop) is unwrapped once.
  return isObject(value) && "__esModule" in value ? readDefault(value) : value;
}

function namesOf(mod: unknown): string[] {
  if (!isObject(mod) && typeof mod !== "function") {
    return [];
  }
  return Object.keys(mod).filter(
    (name) => name !== "__esModule" && name !== "module.exports"
  );
}

function isRequireEsmError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  return (
    error.code === "ERR_REQUIRE_ESM" ||
    error.code === "ERR_REQUIRE_ASYNC_MODULE"
  );
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
      value: pickDefault(isObject(ns) ? readDefault(ns) : undefined),
      exportNames: namesOf(ns),
    };
  }
}

// Nothing is cached here: Node does not cache a CommonJS module that threw while loading, so the next send retries it.
// A native ESM module that failed to evaluate stays failed until the process restarts (D-22); no retry is added.
export async function loadTemplate(
  file: string,
  template: string
): Promise<LoadedTemplate> {
  // createRequire rejects a relative path, so resolve against process.cwd() first, as 0.2.5 did implicitly.
  const absolute = path.resolve(file);
  try {
    return await importOrRequire(absolute);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ReactAdapterError(
      REACT_ADAPTER_ERROR_CODES.TEMPLATE_LOAD_FAILED,
      `Template "${template}" (${absolute}) failed to load: ${reason}. A CommonJS template is loaded again on the next send; a native ESM template that failed to load stays failed until the application restarts.`,
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
  return (
    isObject(value) &&
    !isValidElement(value) &&
    "$$typeof" in value &&
    typeof value.$$typeof === "symbol"
  );
}

// Says what a rejected default export was, for the INVALID_EXPORT message.
export function describeExport(
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
  if (isObject(value)) {
    const keys = Object.keys(value);
    const found = `an object with keys [${keys.join(", ")}]`;
    return keys.includes("default")
      ? `${found}; exports.default was set without the __esModule marker and is not unwrapped: assign the component to module.exports, or compile with an __esModule marker`
      : found;
  }
  return `a ${typeof value}`;
}
