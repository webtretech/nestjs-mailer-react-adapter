import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { REACT_ADAPTER_ERROR_CODES } from "../src";
import type { ReactAdapterOptions } from "../src";

// Ties README.md to the source and to package.json, so a documented fact cannot drift silently.

function read(relative: string): string {
  return readFileSync(
    fileURLToPath(new URL(relative, import.meta.url)),
    "utf8"
  );
}

type PackageJson = {
  engines: { node: string };
  peerDependencies: Record<string, string>;
};

const readme = read("../README.md");
const pkg = JSON.parse(read("../package.json")) as PackageJson;

type Fence = { lang: string; body: string };

function fences(markdown: string): Fence[] {
  const blocks: Fence[] = [];
  let current: { lang: string; lines: string[] } | undefined;
  for (const line of markdown.split("\n")) {
    if (current === undefined) {
      if (line.startsWith("```")) {
        current = { lang: line.slice(3).trim(), lines: [] };
      }
    } else if (line.trim() === "```") {
      blocks.push({ lang: current.lang, body: current.lines.join("\n") });
      current = undefined;
    } else {
      current.lines.push(line);
    }
  }
  return blocks;
}

// The text under `## HEADING` up to the next `## ` line; headings inside code fences do not count.
function section(markdown: string, heading: string): string {
  const lines = markdown.split("\n");
  const collected: string[] = [];
  let inFence = false;
  let found = false;
  for (const line of lines) {
    if (line.startsWith("```")) {
      inFence = !inFence;
    }
    if (!inFence && line.startsWith("## ")) {
      if (found) {
        break;
      }
      found = line === `## ${heading}`;
      continue;
    }
    if (found) {
      collected.push(line);
    }
  }
  if (!found) {
    throw new Error(`README section "${heading}" is missing`);
  }
  return collected.join("\n");
}

const OPTION_KEYS = [
  "pretty",
  "text",
  "htmlToTextOptions",
  "unstableTextConversion",
  "unsafeAllowOutsideTemplateDir",
  "plainText",
] as const satisfies readonly (keyof ReactAdapterOptions)[];

// Adding an option to ReactAdapterOptions without listing it above makes this a type error.
type MissingOptionKeys = Exclude<
  keyof ReactAdapterOptions,
  (typeof OPTION_KEYS)[number]
>;
const allOptionsListed: [MissingOptionKeys] extends [never] ? true : false =
  true;

describe("README", () => {
  test("has at most one adapter key per code block and no deprecated plainText setting", () => {
    const blocks = fences(readme);
    for (const { body } of blocks) {
      expect(body.match(/\badapter\s*:/g)?.length ?? 0).toBeLessThanOrEqual(1);
      expect(body).not.toMatch(/\bplainText\s*:/);
    }
    expect(blocks.some(({ body }) => body.includes("new ReactAdapter("))).toBe(
      true
    );
  });

  test("lists every adapter option in the Options table", () => {
    expect(allOptionsListed).toBe(true);
    const options = section(readme, "Options");
    for (const key of OPTION_KEYS) {
      expect(options, `Options table row for ${key}`).toContain(
        `\n| \`${key}\``
      );
    }
    expect(options).toContain("@react-email/render");
  });

  test("states the Node floor, the peer ranges and the compiled-template rule", () => {
    expect(readme).toContain(pkg.engines.node);
    for (const [name, range] of Object.entries(pkg.peerDependencies)) {
      expect(readme).toContain(`\`${name}\``);
      expect(readme).toContain(range);
    }
    expect(readme).toContain("react-jsx");
    expect(section(readme, "Setup")).toContain("`.js`, `.cjs` and `.mjs`");
  });

  test("documents text-part behaviour per mailer major as pinned by the contract", () => {
    const text = section(readme, "Text part");
    const row = (prefix: string) =>
      text.split("\n").find((line) => line.startsWith(prefix)) ?? "";
    for (const major of ["| v2", "| v3"]) {
      expect(row(major), major).toContain("No text part");
      expect(row(major), major).toContain("Adapter text part");
    }
    const v4 = row("| v4");
    expect(v4).toContain("textFromHtml");
    expect(v4).toContain("render()");
    expect(v4).toContain("Adapter text part");
    expect(text).toContain("never replaced");
    expect(text).toContain("passes through unchanged");
    expect(text).toContain("upper-cases headings");

    // The table restates these assertions; if the contract changes, this fails until the README does.
    const contract = read("../scripts/contract/contract.test.mjs");
    for (const assertion of [
      "assert.match(message.text, /^Hello Ann/)",
      'assert.equal("text" in message, false)',
      "assert.equal(rendered.text, undefined)",
      "assert.match(message.text, /^HELLO ANN/)",
      "assert.match(rendered.text, /^HELLO ANN/)",
    ]) {
      expect(contract, assertion).toContain(assertion);
    }
  });

  test("lists exactly the exported error codes and fields", () => {
    const errors = section(readme, "Errors");
    const documented = new Set(errors.match(/ERR_REACT_ADAPTER_[A-Z_]+/g));
    expect(documented).toEqual(
      new Set(Object.values(REACT_ADAPTER_ERROR_CODES))
    );
    for (const field of ["path", "searched", "roots"]) {
      expect(errors).toContain(`\`${field}\``);
    }
    expect(errors).toContain("MailerTemplateError");
  });

  test("gives a runner-agnostic CI recipe", () => {
    const recipes = fences(readme).filter(
      ({ lang, body }) =>
        lang === "js" && body.startsWith("// check-templates.mjs")
    );
    expect(recipes).toHaveLength(1);
    const body = recipes[0]?.body ?? "";
    expect(body).toContain("new Set(");
    expect(body).toContain("no compiled templates in");
    // A bare runner call; RegExp.prototype.test, as in `/x/.test(file)`, is a method call and allowed.
    expect(body).not.toMatch(/(?<![.\w])(describe|it|test|expect)\(/);
    expect(body).not.toMatch(/jest|vitest/i);
  });

  test("lists the refused template names in Security", () => {
    const security = section(readme, "Security");
    for (const word of [
      "NUL",
      "URL scheme",
      "drive-letter",
      "UNC",
      "Windows",
      "unsafeAllowOutsideTemplateDir",
    ]) {
      expect(security, word).toContain(word);
    }
  });

  test("uses absolute links only", () => {
    expect(readme).not.toMatch(/\]\((?!https?:\/\/|#)/);
    expect(readme).toContain(
      "https://github.com/webtretech/nestjs-mailer-react-adapter/blob/main/docs/MIGRATION.md"
    );
    expect(readme).not.toMatch(/provenance/i);
  });
});

describe("MIGRATION", () => {
  const migration = read("../docs/MIGRATION.md");
  const ACTION = "## Action needed";
  const BEHAVIOUR = "## Behaviour changes, no action needed";

  test("groups changes by action", () => {
    expect(migration).toContain(ACTION);
    expect(migration).toContain(BEHAVIOUR);
    expect(migration.indexOf(ACTION)).toBeLessThan(
      migration.indexOf(BEHAVIOUR)
    );
    // Snippet markers sit inside list-item code blocks, so indentation is ignored.
    const lines = section(migration, "Action needed")
      .split("\n")
      .map((line) => line.trim());
    const count = (...markers: string[]) =>
      lines.filter((line) => markers.includes(line)).length;
    expect(count("// 0.2.x", "# 0.2.x")).toBeGreaterThanOrEqual(4);
    expect(count("// 0.3.0", "# 0.3.0")).toBeGreaterThanOrEqual(4);
  });

  test("covers every required change", () => {
    const required = [
      "unsafeAllowOutsideTemplateDir",
      "template.dirs",
      "2.0.1",
      "^2.0.1 || ^3.0.0 || ^4.0.0",
      ">=20.19",
      "^18.0.0 || ^19.0.0",
      "@types/react",
      "plainText",
      "REACT_ADAPTER_DEP0001",
      "ReactAdapterError",
      "error.path",
      "error.searched",
      "error.roots",
      "unhandled rejection",
      "welcome.v2",
      "index.cjs",
      "index.mjs",
      "index.d.cts",
      "index.d.mts",
      "MODULE_NOT_FOUND",
      "TypeError",
      "MailerTemplateError",
      "textFromHtml",
      "`text` wins when both are set",
      "`template.dir` is searched first, then `template.dirs` in order",
      ...Object.values(REACT_ADAPTER_ERROR_CODES),
    ];
    for (const item of required) {
      expect(migration, item).toContain(item);
    }
  });

  test("makes no unpinned claims", () => {
    expect(migration).not.toMatch(/provenance/i);
    expect(
      existsSync(fileURLToPath(new URL("../CHANGELOG.md", import.meta.url)))
    ).toBe(false);
  });
});
