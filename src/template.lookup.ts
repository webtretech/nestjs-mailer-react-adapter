import { stat } from "node:fs/promises";
import path from "node:path";

import { REACT_ADAPTER_ERROR_CODES, ReactAdapterError } from "./adapter.errors";
import {
  classifyTemplateName,
  isInsideRoot,
  isNotHereError,
  isRecord,
  isUncNameAllowed,
  ownProperty,
  quotedTemplateName,
  resolveRealLocation,
  type NameVerdict,
} from "./template.confine";

export const KNOWN_EXTENSIONS = [".js", ".cjs", ".mjs"] as const;

// template.dir first, then each template.dirs entry in array order, as the mailer's own adapters search them.
// Anything that is not a non-empty string contributes nothing; no mailer-version detection happens here.
// These are the confinement roots, so only own properties count: a polluted Object.prototype or
// Array.prototype (an inherited dir or dirs, an array hole, a replaced iterator) never adds a root.
export function templateDirectories(templateOptions: unknown): string[] {
  const dir = ownProperty(templateOptions, "dir");
  const dirs = ownProperty(templateOptions, "dirs");
  const directories: string[] = [];
  if (typeof dir === "string" && dir !== "") {
    directories.push(dir);
  }
  if (Array.isArray(dirs)) {
    const entries: unknown[] = dirs;
    for (let index = 0; index < entries.length; index += 1) {
      const entry = ownProperty(entries, index);
      if (typeof entry === "string" && entry !== "") {
        directories.push(entry);
      }
    }
  }
  return directories;
}

export function candidateFiles(
  template: string,
  directories: readonly string[]
): string[] {
  const hasKnownExtension = (KNOWN_EXTENSIONS as readonly string[]).includes(
    path.extname(template)
  );
  const names = hasKnownExtension
    ? [template]
    : KNOWN_EXTENSIONS.map((extension) => template + extension);
  // An absolute name ignores every directory; a relative one is tried in each directory in turn,
  // all extensions in one directory before the next. A path already listed keeps its first position.
  const files = path.isAbsolute(template)
    ? names.map((name) => path.normalize(name))
    : directories.flatMap((directory) =>
        names.map((name) => path.resolve(directory, name))
      );
  return [...new Set(files)];
}

// `toStat` is the real location that is inspected; `reported` is the candidate that errors name.
async function isFile(
  toStat: string,
  reported: string,
  template: string
): Promise<boolean> {
  try {
    return (await stat(toStat)).isFile();
  } catch (error) {
    if (isNotHereError(error)) {
      return false;
    }
    throw loadFailed(template, reported, error);
  }
}

function loadFailed(
  template: string,
  file: string,
  cause: unknown
): ReactAdapterError {
  const code =
    isRecord(cause) && typeof cause["code"] === "string"
      ? cause["code"]
      : "unknown error";
  return new ReactAdapterError(
    REACT_ADAPTER_ERROR_CODES.TEMPLATE_LOAD_FAILED,
    `Could not inspect a candidate file for template ${quotedTemplateName(template)} (${code}); see error.path and error.cause.`,
    { template, path: file, cause }
  );
}

const INVALID_REASONS: Record<Exclude<NameVerdict, "ok">, string> = {
  "nul-byte": "it contains a NUL byte",
  "url-scheme": "it starts with a URL scheme",
  "windows-device": "it is a Windows device or verbatim path",
  "windows-drive-or-unc":
    "it is a Windows drive-letter or UNC path, which is accepted only on Windows",
};

// The message shows the name through quotedTemplateName (messageTemplateName, JSON-escaped), so an absolute name
// appears only by its last segment and a NUL byte appears as \u0000.
function invalidTemplateName(
  template: string,
  reason: string
): ReactAdapterError {
  return new ReactAdapterError(
    REACT_ADAPTER_ERROR_CODES.INVALID_TEMPLATE_NAME,
    `Template name ${quotedTemplateName(template)} is not allowed: ${reason}.`,
    { template }
  );
}

export async function locateTemplate(
  template: string,
  templateOptions: unknown,
  confinement: { readonly allowOutside: boolean }
): Promise<string> {
  const verdict = classifyTemplateName(template);
  if (verdict !== "ok") {
    throw invalidTemplateName(template, INVALID_REASONS[verdict]);
  }
  const directories = templateDirectories(templateOptions);
  // The UNC share guard needs no I/O and runs before any filesystem call, so a refused UNC name
  // never makes the host contact the named server.
  if (!isUncNameAllowed(template, directories, confinement.allowOutside)) {
    throw invalidTemplateName(
      template,
      "it is a UNC path on a server and share that no configured template root uses"
    );
  }
  if (!path.isAbsolute(template) && directories.length === 0) {
    throw new ReactAdapterError(
      REACT_ADAPTER_ERROR_CODES.TEMPLATE_DIR_MISSING,
      `Template ${quotedTemplateName(template)} is a relative name but template.dir (and template.dirs) is not set, so it cannot be resolved. Set template.dir in the mailer options.`,
      { template }
    );
  }
  if (
    path.isAbsolute(template) &&
    directories.length === 0 &&
    !confinement.allowOutside
  ) {
    throw new ReactAdapterError(
      REACT_ADAPTER_ERROR_CODES.TEMPLATE_OUTSIDE_ROOT,
      `Template ${quotedTemplateName(template)} is an absolute name, but no template.dir or template.dirs is configured, so it lies outside every template root. Set template.dir, or construct ReactAdapter with unsafeAllowOutsideTemplateDir: true.`,
      { template, roots: [] }
    );
  }
  const candidates = candidateFiles(template, directories);
  const roots = [
    ...new Set(directories.map((directory) => path.resolve(directory))),
  ];
  // D-17: one rule. Every root and every candidate is judged by its real location, so spelling,
  // aliases and letter case decide nothing beyond what the filesystem says.
  const realRoots = confinement.allowOutside
    ? []
    : await Promise.all(
        roots.map(async (root) => (await resolveRealLocation(root)).location)
      );
  // D-24: an outside candidate is skipped (never stat'ed) and remembered; the lookup goes on.
  let firstOutside: string | undefined;
  for (const candidate of candidates) {
    const { location, failure } = await resolveRealLocation(candidate);
    if (
      !confinement.allowOutside &&
      !realRoots.some((realRoot) => isInsideRoot(realRoot, location))
    ) {
      firstOutside ??= candidate;
      continue;
    }
    if (failure !== undefined) {
      throw loadFailed(template, candidate, failure.cause);
    }
    if (await isFile(location, candidate, template)) {
      // D-22: the file that was verified is the file that is loaded.
      return location;
    }
  }
  if (firstOutside !== undefined) {
    throw new ReactAdapterError(
      REACT_ADAPTER_ERROR_CODES.TEMPLATE_OUTSIDE_ROOT,
      `Template ${quotedTemplateName(template)} resolves outside the configured template roots (see error.roots), so it was not loaded. To allow it, construct ReactAdapter with unsafeAllowOutsideTemplateDir: true.`,
      { template, path: firstOutside, roots }
    );
  }
  throw new ReactAdapterError(
    REACT_ADAPTER_ERROR_CODES.TEMPLATE_NOT_FOUND,
    `Template ${quotedTemplateName(template)} was not found; searched ${candidates.length} ${candidates.length === 1 ? "location" : "locations"}, see error.searched.`,
    { template, path: candidates[0], searched: candidates, roots }
  );
}
