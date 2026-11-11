import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { isValidElement } from "react";
import type { ElementType } from "react";

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

export async function loadTemplate(file: string): Promise<LoadedTemplate> {
  // createRequire rejects a relative path, so resolve against process.cwd() first, as 0.2.5 did implicitly.
  const absolute = path.resolve(file);
  try {
    const mod: unknown = createRequire(absolute)(absolute);
    return {
      value: pickDefault(isModuleRecord(mod) ? readDefault(mod) : mod),
      exportNames: namesOf(mod),
    };
  } catch (error) {
    if (!isRequireEsmError(error)) {
      throw error;
    }
    const ns: unknown = await import(pathToFileURL(absolute).href);
    return {
      value: pickDefault(isObject(ns) ? readDefault(ns) : undefined),
      exportNames: namesOf(ns),
    };
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
