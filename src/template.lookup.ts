import { stat } from "node:fs/promises";
import path from "node:path";

import { REACT_ADAPTER_ERROR_CODES, ReactAdapterError } from "./adapter.errors";
import {
  classifyTemplateName,
  isUncNameAllowed,
  messageTemplateName,
  type NameVerdict,
} from "./template.confine";

export const KNOWN_EXTENSIONS = [".js", ".cjs", ".mjs"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNotHereError(error: unknown): boolean {
  if (!isRecord(error) || !("code" in error)) {
    return false;
  }
  return error.code === "ENOENT" || error.code === "ENOTDIR";
}

// template.dir first, then each template.dirs entry in array order, as the mailer's own adapters search them.
// Anything that is not a non-empty string contributes nothing; no mailer-version detection happens here.
export function templateDirectories(templateOptions: unknown): string[] {
  if (!isRecord(templateOptions)) {
    return [];
  }
  const { dir, dirs } = templateOptions;
  const directories: string[] = [];
  if (typeof dir === "string" && dir !== "") {
    directories.push(dir);
  }
  if (Array.isArray(dirs)) {
    const entries: unknown[] = dirs;
    for (const entry of entries) {
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

async function isFile(file: string, template: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch (error) {
    if (isNotHereError(error)) {
      return false;
    }
    throw new ReactAdapterError(
      REACT_ADAPTER_ERROR_CODES.TEMPLATE_LOAD_FAILED,
      `Could not inspect template file "${file}" for template "${template}".`,
      { template, path: file, cause: error }
    );
  }
}

const INVALID_REASONS: Record<Exclude<NameVerdict, "ok">, string> = {
  "nul-byte": "it contains a NUL byte",
  "url-scheme": "it starts with a URL scheme",
  "windows-device": "it is a Windows device or verbatim path",
  "windows-drive-or-unc":
    "it is a Windows drive-letter or UNC path, which is accepted only on Windows",
};

// The message shows the name through messageTemplateName and JSON-escapes it, so an absolute name
// appears only by its last segment and a NUL byte appears as \u0000.
function invalidTemplateName(
  template: string,
  reason: string
): ReactAdapterError {
  return new ReactAdapterError(
    REACT_ADAPTER_ERROR_CODES.INVALID_TEMPLATE_NAME,
    `Template name ${JSON.stringify(messageTemplateName(template))} is not allowed: ${reason}.`,
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
      `Template "${template}" is a relative name but template.dir (and template.dirs) is not set, so it cannot be resolved. Set template.dir in the mailer options.`,
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
      `Template "${messageTemplateName(template)}" is an absolute name, but no template.dir or template.dirs is configured, so it lies outside every template root. Set template.dir, or construct ReactAdapter with unsafeAllowOutsideTemplateDir: true.`,
      { template, roots: [] }
    );
  }
  const candidates = candidateFiles(template, directories);
  for (const candidate of candidates) {
    if (await isFile(candidate, template)) {
      return candidate;
    }
  }
  throw new ReactAdapterError(
    REACT_ADAPTER_ERROR_CODES.TEMPLATE_NOT_FOUND,
    `Template "${template}" was not found. Searched: ${candidates.join(", ")}`,
    { template, path: candidates[0], searched: candidates }
  );
}
