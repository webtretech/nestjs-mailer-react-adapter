import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { MailerOptions } from "@nestjs-modules/mailer";
import { expect } from "vitest";

import { ReactAdapter, ReactAdapterError } from "../src";
import type { ReactAdapterErrorCode } from "../src";

export interface Outcome {
  /** Arguments of the first callback call. */
  args: unknown[];
  /** How many times the callback ran by the time the outcome settled. */
  calls: number;
  /** What compile() threw synchronously, if anything. A thrown `undefined` shows as a marker Error, never as undefined. */
  threw: unknown;
  /** True when compile() threw synchronously, whatever it threw. */
  didThrow: boolean;
  /** True when the callback ran before compile() returned. */
  early: boolean;
  /** mail.data.html once the outcome settled. */
  html: unknown;
}

function readHtml(mail: unknown): unknown {
  if (typeof mail !== "object" || mail === null || !("data" in mail)) {
    return undefined;
  }
  const { data } = mail;
  if (typeof data !== "object" || data === null || !("html" in data)) {
    return undefined;
  }
  return data.html;
}

// Resolves 50 ms after the first callback so a second call is counted, or after 2000 ms when none arrives.
// A callback that arrives after the outcome settled throws instead of being ignored: the throw surfaces as an
// unhandled rejection, which fails the test run, so a late second call cannot pass unnoticed.
export async function compileOnce(
  adapter: ReactAdapter,
  mail: unknown,
  options: MailerOptions
): Promise<Outcome> {
  const outcome = await new Promise<Outcome>((resolve) => {
    let calls = 0;
    let first: unknown[] = [];
    let returned = false;
    let early = false;
    let threw: unknown;
    let didThrow = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (): void => {
      settled = true;
      resolve({
        args: first,
        calls,
        threw,
        didThrow,
        early,
        html: readHtml(mail),
      });
    };
    try {
      adapter.compile(
        mail,
        (...args: unknown[]) => {
          if (settled) {
            throw new Error(
              "compile() called its callback again after the outcome settled"
            );
          }
          calls += 1;
          if (!returned) {
            early = true;
          }
          if (calls === 1) {
            first = args;
            clearTimeout(timer);
            setTimeout(finish, 50);
          }
        },
        options
      );
    } catch (error) {
      didThrow = true;
      threw =
        error === undefined ? new Error("compile() threw undefined") : error;
    }
    returned = true;
    if (didThrow) {
      setTimeout(finish, 50);
    } else if (calls === 0) {
      timer = setTimeout(finish, 2000);
    }
  });
  return outcome;
}

// Builds the mail the mailer would hand over for `template` and compiles it once.
export function compileTemplate(
  template: string,
  options: MailerOptions,
  adapter: ReactAdapter = new ReactAdapter()
): Promise<Outcome> {
  const mail = {
    data: { template, context: { body: "Body" }, html: undefined as unknown },
  };
  return compileOnce(adapter, mail, options);
}

export function expectAdapterError(
  outcome: Outcome,
  code: ReactAdapterErrorCode
): ReactAdapterError {
  expect(outcome.calls).toBe(1);
  expect(outcome.didThrow).toBe(false);
  expect(outcome.threw).toBeUndefined();
  expect(outcome.early).toBe(false);
  expect(outcome.args).toHaveLength(1);
  const [error] = outcome.args;
  expect(error).toBeInstanceOf(ReactAdapterError);
  if (!(error instanceof ReactAdapterError)) {
    throw new Error("expected a ReactAdapterError");
  }
  expect(error.code).toBe(code);
  return error;
}

// Writes a template with no imports whose component renders `marker:<props.body>`.
export async function writeTemplate(
  file: string,
  marker: string
): Promise<void> {
  const body = `function Template(props) { return ${JSON.stringify(marker + ":")} + props.body; }`;
  const source = file.endsWith(".mjs")
    ? `export default ${body}\n`
    : `module.exports = ${body};\n`;
  await fs.writeFile(file, source);
}

// A fresh temporary folder under os.tmpdir(), returned by its real path (macOS keeps /var -> /private/var).
export async function makeTempRoot(prefix: string): Promise<string> {
  return fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const { code } = error;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

// CI is on when GITHUB_ACTIONS is "true" or CI is set to anything but "", "0" or "false" (any case).
export function isCiEnvironment(
  env: Record<string, string | undefined>
): boolean {
  const ci = (env["CI"] ?? "").toLowerCase();
  return env["GITHUB_ACTIONS"] === "true" || !["", "0", "false"].includes(ci);
}

let linkSkipNoted = false;

// Outside CI the symlink tests skip when links cannot be created. The skip reason is easy to miss in the
// reporter output, so print one line per test file (stderr is shown with the file's results; no console call).
function noteSkippedLinks(reason: string): void {
  if (linkSkipNoted) {
    return;
  }
  linkSkipNoted = true;
  process.stderr.write(
    `NOTE: symlinks cannot be created on this host (${reason}); the symlink tests are skipped here and fail in CI.\n`
  );
}

// Creates a symlink with an absolute target. A directory link on Windows falls back to a junction.
// When a link cannot be created, CI fails loudly (no symlink test may pass vacuously); elsewhere a permission
// failure (EPERM, EACCES) returns false so the caller can skip with a visible note, and any other error throws.
export async function makeLink(
  target: string,
  link: string,
  kind: "file" | "dir"
): Promise<boolean> {
  try {
    try {
      await fs.symlink(target, link, kind);
    } catch (error) {
      const code = errorCode(error);
      if (
        kind === "dir" &&
        process.platform === "win32" &&
        (code === "EPERM" || code === "EACCES")
      ) {
        await fs.symlink(target, link, "junction");
      } else {
        throw error;
      }
    }
  } catch (error) {
    const code = errorCode(error);
    // Only a permission failure can mean the host cannot link; any other error is a bug in the test and is
    // rethrown on every host, with the link path and the code in the message.
    if (
      isCiEnvironment(process.env) ||
      (code !== "EPERM" && code !== "EACCES")
    ) {
      throw new Error(
        `Could not create the ${kind} link ${link} -> ${target}: ${code ?? String(error)}`,
        { cause: error }
      );
    }
    noteSkippedLinks(code);
    return false;
  }
  expect((await fs.lstat(link)).isSymbolicLink()).toBe(true);
  return true;
}
