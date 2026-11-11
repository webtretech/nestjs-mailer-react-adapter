import fs from "node:fs/promises";

import type { MailerOptions } from "@nestjs-modules/mailer";
import { expect } from "vitest";

import { ReactAdapter, ReactAdapterError } from "../src";
import type { ReactAdapterErrorCode } from "../src";

export interface Outcome {
  /** Arguments of the first callback call. */
  args: unknown[];
  /** How many times the callback ran by the time the outcome settled. */
  calls: number;
  /** What compile() threw synchronously, if anything. */
  threw: unknown;
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (): void => {
      resolve({ args: first, calls, threw, early, html: readHtml(mail) });
    };
    try {
      adapter.compile(
        mail,
        (...args: unknown[]) => {
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
      threw = error;
    }
    returned = true;
    if (threw !== undefined) {
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
