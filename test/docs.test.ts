import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

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
});
