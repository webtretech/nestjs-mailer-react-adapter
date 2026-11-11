import { stat } from "node:fs/promises";
import path from "node:path";

import { ReactAdapterError } from "./adapter.errors";

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
      "ERR_REACT_ADAPTER_TEMPLATE_LOAD_FAILED",
      `Could not inspect template file "${file}" for template "${template}".`,
      { template, path: file, cause: error }
    );
  }
}

export async function locateTemplate(
  template: string,
  templateOptions: unknown
): Promise<string> {
  const directories = templateDirectories(templateOptions);
  if (!path.isAbsolute(template) && directories.length === 0) {
    throw new ReactAdapterError(
      "ERR_REACT_ADAPTER_TEMPLATE_DIR_MISSING",
      `Template "${template}" is a relative name but template.dir (and template.dirs) is not set, so it cannot be resolved. Set template.dir in the mailer options or pass an absolute template path.`,
      { template }
    );
  }
  const candidates = candidateFiles(template, directories);
  for (const candidate of candidates) {
    if (await isFile(candidate, template)) {
      return candidate;
    }
  }
  throw new ReactAdapterError(
    "ERR_REACT_ADAPTER_TEMPLATE_NOT_FOUND",
    `Template "${template}" was not found. Searched: ${candidates.join(", ")}`,
    { template, path: candidates[0], searched: candidates }
  );
}
