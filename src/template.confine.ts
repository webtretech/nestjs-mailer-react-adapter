import { realpath } from "node:fs/promises";
import path from "node:path";

// Internal module: the rules of template confinement. The name rules and isInsideRoot are pure; the
// only I/O is resolveRealLocation, which asks the filesystem for real paths and never reads a file.
// The path flavor is a parameter so the Windows rules can be tested on every OS: production passes
// the host `path` (which IS `path.win32` on Windows), tests pass `path.posix` or `path.win32`.

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Like isRecord, but arrays do not count. Used for mail and option objects, where an array is a caller mistake.
// isRecord stays array-permitting on purpose: its callers inspect module records and error values.
export function isPlainObjectLike(
  value: unknown
): value is Record<string, unknown> {
  return isRecord(value) && !Array.isArray(value);
}

// Reads only an own property: a value inherited through a polluted prototype never counts.
export function ownProperty(value: unknown, key: PropertyKey): unknown {
  return isRecord(value) && Object.hasOwn(value, key)
    ? Reflect.get(value, key)
    : undefined;
}

export function isNotHereError(error: unknown): boolean {
  if (!isRecord(error) || !("code" in error)) {
    return false;
  }
  return error.code === "ENOENT" || error.code === "ENOTDIR";
}

export interface RealLocation {
  readonly location: string;
  readonly failure: { readonly cause: unknown } | undefined;
}

// The real location of a file that may not exist: the realpath of its deepest resolvable
// ancestor plus the remaining tail of base names. `file` is absolute and normalized (candidateFiles
// and path.resolve guarantee it), so the tail never holds `..`. An error other than ENOENT or ENOTDIR
// (ELOOP, ENAMETOOLONG, EACCES) is returned as `failure`; the location is still the best one known.
export async function resolveRealLocation(file: string): Promise<RealLocation> {
  let failure: RealLocation["failure"];
  const remember = (error: unknown): void => {
    if (failure === undefined && !isNotHereError(error)) {
      failure = { cause: error };
    }
  };
  try {
    return { location: await realpath(file), failure: undefined };
  } catch (error) {
    remember(error);
  }
  const tail: string[] = [];
  let current = file;
  for (;;) {
    const parent = path.dirname(current);
    if (parent === current) {
      return { location: file, failure };
    }
    tail.unshift(path.basename(current));
    current = parent;
    try {
      return { location: path.join(await realpath(current), ...tail), failure };
    } catch (error) {
      remember(error);
    }
  }
}

// Containment between two real locations: path.relative, never a string-prefix test.
// `..hidden.js` is a legal name, hence `".." + sep` rather than startsWith("..").
export function isInsideRoot(
  root: string,
  candidate: string,
  flavor: typeof path = path
): boolean {
  const rel = flavor.relative(root, candidate);
  return (
    rel === "" ||
    (rel !== ".." &&
      !rel.startsWith(".." + flavor.sep) &&
      !flavor.isAbsolute(rel))
  );
}

export type NameVerdict =
  "ok" | "nul-byte" | "url-scheme" | "windows-device" | "windows-drive-or-unc";

// One ASCII letter, then one or more scheme characters, then a colon. The two-character minimum
// means a single letter before the colon is a drive form and never a scheme.
const SCHEME_PREFIX = /^[A-Za-z][A-Za-z0-9+.-]+:/;
// Two separators, then `?` or `.`, then a separator or the end: \\?\C:\x, \\.\pipe\x, //?/x, //./x.
const DEVICE_PREFIX = /^[\\/]{2}[?.](?:[\\/]|$)/;
const DRIVE_PREFIX = /^[A-Za-z]:/;
const UNC_PREFIX = /^[\\/]{2}/;

const SEPARATORS = /[\\/]/;

// Fixed order, first match wins: NUL byte, URL scheme, device or verbatim form, then (off Windows only)
// drive letter or UNC. A name that survives is judged by the real-location rules elsewhere.
export function classifyTemplateName(
  name: string,
  flavor: typeof path = path
): NameVerdict {
  if (name.includes("\0")) {
    return "nul-byte";
  }
  if (SCHEME_PREFIX.test(name)) {
    return "url-scheme";
  }
  if (DEVICE_PREFIX.test(name)) {
    return "windows-device";
  }
  if (
    flavor !== path.win32 &&
    (DRIVE_PREFIX.test(name) || UNC_PREFIX.test(name))
  ) {
    return "windows-drive-or-unc";
  }
  return "ok";
}

// The server and share of a UNC path, or undefined when either part is empty or the path is not UNC.
function uncServerAndShare(
  value: string
): { server: string; share: string } | undefined {
  if (!UNC_PREFIX.test(value)) {
    return undefined;
  }
  const [server, share] = value.slice(2).split(SEPARATORS);
  if (
    server === undefined ||
    server === "" ||
    share === undefined ||
    share === ""
  ) {
    return undefined;
  }
  return { server: server.toLowerCase(), share: share.toLowerCase() };
}

// The Windows UNC share guard: text only, no DNS and no filesystem. A UNC name passes only when a
// configured root, resolved, is a UNC path on the same server and share (letter case ignored).
// With the opt-out the guard is off, and a name that is not UNC is none of its business.
export function isUncNameAllowed(
  name: string,
  roots: readonly string[],
  allowOutside: boolean,
  flavor: typeof path = path
): boolean {
  if (allowOutside || !UNC_PREFIX.test(name)) {
    return true;
  }
  const wanted = uncServerAndShare(name);
  if (wanted === undefined) {
    return false;
  }
  return roots.some((root) => {
    const have = uncServerAndShare(flavor.resolve(root));
    return (
      have !== undefined &&
      have.server === wanted.server &&
      have.share === wanted.share
    );
  });
}

// The name as an error message shows it: an absolute name (under either flavor's rules) or a URL-scheme
// name appears as its last path segment, a relative name as given. Same result on every OS.
export function messageTemplateName(name: string): string {
  if (
    path.posix.isAbsolute(name) ||
    path.win32.isAbsolute(name) ||
    SCHEME_PREFIX.test(name)
  ) {
    const parts = name.split(SEPARATORS).filter((part) => part !== "");
    return parts[parts.length - 1] ?? "";
  }
  return name;
}

// What JSON.stringify leaves raw although a terminal or a log viewer acts on it: DEL and the C1 controls
// (U+0080 to U+009F, among them U+009B, the 8-bit CSI that xterm and VTE treat as an escape introducer), the
// invisible direction marks (U+061C, U+200E, U+200F), the bidi embeddings, overrides and isolates (U+202A to
// U+202E, U+2066 to U+2069), the line and paragraph separators (U+2028, U+2029) and the byte order mark (U+FEFF).
const UNSAFE_AFTER_JSON =
  /[\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g;

// The name quoted for an error message: messageTemplateName, JSON-escaped, so a newline, an ANSI escape or an
// embedded quote in a relative name appears as a visible escape (\n, \u001b, \") rather than as a raw character
// in a log. A C1 control, DEL, a bidi override or a line separator, which JSON.stringify leaves raw, is escaped
// the same way (U+009B shows as \u009b, U+202E as \u202e). An ordinary name such as welcome reads "welcome", with
// its own quotes. A backslash shows doubled (sub\welcome reads "sub\\welcome") by design. Internal: not exported
// from index.
export function quotedTemplateName(name: string): string {
  return JSON.stringify(messageTemplateName(name)).replace(
    UNSAFE_AFTER_JSON,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}
