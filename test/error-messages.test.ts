import fs, { stat } from "node:fs/promises";
import type * as FsPromisesModule from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { MailerOptions } from "@nestjs-modules/mailer";
import { pretty, toPlainText } from "@react-email/render";
import type * as RenderModule from "@react-email/render";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";

import { REACT_ADAPTER_ERROR_CODES, ReactAdapter } from "../src";
import type { ReactAdapterError, ReactAdapterErrorCode } from "../src";
import {
  compileOnce,
  compileTemplate,
  expectAdapterError,
  makeLink,
  makeTempRoot,
  writeTemplate,
} from "./helpers";
import type { Outcome } from "./helpers";

// Pass-through spies: the real functions run, a test makes one call fail.
vi.mock("@react-email/render", async (importOriginal) => {
  const actual = await importOriginal<typeof RenderModule>();
  return {
    ...actual,
    render: vi.fn(actual.render),
    pretty: vi.fn(actual.pretty),
    toPlainText: vi.fn(actual.toPlainText),
    unstableToPlainText: vi.fn(actual.unstableToPlainText),
  };
});

// Only stat is replaced (the lookup's isFile imports it by name); realpath, mkdtemp, symlink, rm and the rest stay real.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromisesModule>();
  return {
    ...actual,
    stat: vi.fn(actual.stat),
  };
});

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures"
);
const PREFIX = "react-adapter-messages-";
const UNC_NAME = "\\\\srv\\sh\\react-adapter-messages-unc\\welcome";

let root: string;
let sibling: string;
let realTmp: string;
let linksWork = true;

beforeAll(async () => {
  root = await makeTempRoot(PREFIX);
  sibling = await makeTempRoot(PREFIX);
  realTmp = await fs.realpath(os.tmpdir());
  await writeTemplate(path.join(root, "welcome.js"), "welcome");
  await writeTemplate(path.join(root, "stat-fail.js"), "stat-fail");
  await fs.writeFile(
    path.join(root, "invalid-export.js"),
    `module.exports = "not a component";\n`
  );
  await fs.writeFile(
    path.join(root, "render-fails.js"),
    `module.exports = function Template() { throw new Error("render boom"); };\n`
  );
  await fs.writeFile(
    path.join(root, "needs-dep.js"),
    `require("./definitely-missing-dependency");\nmodule.exports = function Template() { return "never"; };\n`
  );
  // A two-link symlink loop fails with ELOOP on every OS.
  await fs.mkdir(path.join(root, "loops"));
  linksWork =
    (await makeLink(
      path.join(root, "loops", "loop-b.js"),
      path.join(root, "loops", "loop-a.js"),
      "file"
    )) &&
    (await makeLink(
      path.join(root, "loops", "loop-a.js"),
      path.join(root, "loops", "loop-b.js"),
      "file"
    ));
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(sibling, { recursive: true, force: true });
});

beforeEach(() => {
  vi.mocked(pretty).mockClear();
  vi.mocked(toPlainText).mockClear();
  vi.mocked(stat).mockReset();
});

interface Case {
  label: string;
  code: ReactAdapterErrorCode;
  /** Set when the name is absolute (D-26): the full name that must stay on error.template. */
  absolute?: string;
  fire: () => Promise<Outcome>;
}

function inRoot(): MailerOptions {
  return { template: { dir: root } };
}

function statFailsFor(marker: string): void {
  // Real stat for every other path; an EACCES-coded failure for any path that contains the marker.
  vi.mocked(stat).mockImplementation(async (target, options) => {
    if (String(target).includes(marker)) {
      throw Object.assign(new Error("stat denied"), { code: "EACCES" });
    }
    const actual =
      await vi.importActual<typeof FsPromisesModule>("node:fs/promises");
    return actual.stat(target, options);
  });
}

function prettyFailsOnce(): void {
  vi.mocked(pretty).mockRejectedValueOnce(new Error("formatter boom"));
}

function textFailsOnce(): void {
  vi.mocked(toPlainText).mockImplementationOnce(() => {
    throw new Error("converter boom");
  });
}

function buildCases(): Case[] {
  const loops = path.join(root, "loops");
  const outside = path.join(sibling, "escape");
  const named =
    (
      name: string,
      options: MailerOptions = inRoot()
    ): (() => Promise<Outcome>) =>
    () =>
      compileTemplate(name, options);
  const withPretty =
    (name: string): (() => Promise<Outcome>) =>
    () => {
      prettyFailsOnce();
      return compileTemplate(
        name,
        inRoot(),
        new ReactAdapter({ pretty: true })
      );
    };
  const withText =
    (name: string): (() => Promise<Outcome>) =>
    () => {
      textFailsOnce();
      return compileTemplate(name, inRoot(), new ReactAdapter({ text: true }));
    };
  const absolute = (name: string): string => path.join(root, name);
  return [
    // Relative names
    {
      label: "relative: DIR_MISSING",
      code: REACT_ADAPTER_ERROR_CODES.TEMPLATE_DIR_MISSING,
      fire: named("welcome", {}),
    },
    {
      label: "relative: NOT_FOUND",
      code: REACT_ADAPTER_ERROR_CODES.TEMPLATE_NOT_FOUND,
      fire: named("missing-template"),
    },
    {
      label: "relative: LOAD_FAILED from the lookup (realpath)",
      code: REACT_ADAPTER_ERROR_CODES.TEMPLATE_LOAD_FAILED,
      fire: named("loop-a", { template: { dir: loops } }),
    },
    {
      label: "relative: LOAD_FAILED from the loader",
      code: REACT_ADAPTER_ERROR_CODES.TEMPLATE_LOAD_FAILED,
      fire: named("needs-dep"),
    },
    {
      label: "relative: INVALID_EXPORT",
      code: REACT_ADAPTER_ERROR_CODES.INVALID_EXPORT,
      fire: named("invalid-export"),
    },
    {
      label: "relative: RENDER_FAILED from render",
      code: REACT_ADAPTER_ERROR_CODES.RENDER_FAILED,
      fire: named("render-fails"),
    },
    {
      label: "relative: RENDER_FAILED from pretty",
      code: REACT_ADAPTER_ERROR_CODES.RENDER_FAILED,
      fire: withPretty("welcome"),
    },
    {
      label: "relative: TEXT_FAILED",
      code: REACT_ADAPTER_ERROR_CODES.TEXT_FAILED,
      fire: withText("welcome"),
    },
    {
      label: "NO_BODY",
      code: REACT_ADAPTER_ERROR_CODES.NO_BODY,
      fire: () =>
        compileOnce(
          new ReactAdapter(),
          { data: { html: "", subject: "secret-subject" } },
          inRoot()
        ),
    },
    {
      label: "INVALID_MAIL",
      code: REACT_ADAPTER_ERROR_CODES.INVALID_MAIL,
      fire: () =>
        compileOnce(new ReactAdapter(), { data: { template: 42 } }, inRoot()),
    },
    {
      label: "relative: INVALID_TEMPLATE_NAME (NUL)",
      code: REACT_ADAPTER_ERROR_CODES.INVALID_TEMPLATE_NAME,
      fire: named("nul\u0000name"),
    },
    {
      label: "OUTSIDE_ROOT: ../escape",
      code: REACT_ADAPTER_ERROR_CODES.TEMPLATE_OUTSIDE_ROOT,
      fire: named("../escape"),
    },
    {
      label: "OUTSIDE_ROOT: an absolute name in a sibling directory",
      code: REACT_ADAPTER_ERROR_CODES.TEMPLATE_OUTSIDE_ROOT,
      absolute: outside,
      fire: named(outside),
    },
    {
      label: "OUTSIDE_ROOT: an absolute name with no template root (D-20)",
      code: REACT_ADAPTER_ERROR_CODES.TEMPLATE_OUTSIDE_ROOT,
      absolute: absolute("welcome"),
      fire: named(absolute("welcome"), {}),
    },
    // Absolute names (D-26): every message site that can carry a template name
    {
      label: "absolute: NOT_FOUND",
      code: REACT_ADAPTER_ERROR_CODES.TEMPLATE_NOT_FOUND,
      absolute: absolute("missing-file"),
      fire: named(absolute("missing-file")),
    },
    {
      label: "absolute: LOAD_FAILED from the lookup (realpath)",
      code: REACT_ADAPTER_ERROR_CODES.TEMPLATE_LOAD_FAILED,
      absolute: path.join(loops, "loop-a"),
      fire: named(path.join(loops, "loop-a")),
    },
    {
      label: "absolute: LOAD_FAILED from the lookup (stat)",
      code: REACT_ADAPTER_ERROR_CODES.TEMPLATE_LOAD_FAILED,
      absolute: absolute("stat-fail"),
      fire: () => {
        statFailsFor("stat-fail");
        return compileTemplate(absolute("stat-fail"), inRoot());
      },
    },
    {
      label: "absolute: LOAD_FAILED from the loader",
      code: REACT_ADAPTER_ERROR_CODES.TEMPLATE_LOAD_FAILED,
      absolute: absolute("needs-dep"),
      fire: named(absolute("needs-dep")),
    },
    {
      label: "absolute: INVALID_EXPORT",
      code: REACT_ADAPTER_ERROR_CODES.INVALID_EXPORT,
      absolute: absolute("invalid-export"),
      fire: named(absolute("invalid-export")),
    },
    {
      label: "absolute: RENDER_FAILED from render",
      code: REACT_ADAPTER_ERROR_CODES.RENDER_FAILED,
      absolute: absolute("render-fails"),
      fire: named(absolute("render-fails")),
    },
    {
      label: "absolute: RENDER_FAILED from pretty",
      code: REACT_ADAPTER_ERROR_CODES.RENDER_FAILED,
      absolute: absolute("welcome"),
      fire: withPretty(absolute("welcome")),
    },
    {
      label: "absolute: TEXT_FAILED",
      code: REACT_ADAPTER_ERROR_CODES.TEXT_FAILED,
      absolute: absolute("welcome"),
      fire: withText(absolute("welcome")),
    },
    {
      label: "absolute: INVALID_TEMPLATE_NAME (NUL)",
      code: REACT_ADAPTER_ERROR_CODES.INVALID_TEMPLATE_NAME,
      absolute: absolute("nul\u0000name"),
      fire: named(absolute("nul\u0000name")),
    },
    {
      // Refused by the name rules on POSIX and by the D-23 share guard on Windows, before any I/O.
      label: "absolute: INVALID_TEMPLATE_NAME (UNC with a prefixed component)",
      code: REACT_ADAPTER_ERROR_CODES.INVALID_TEMPLATE_NAME,
      absolute: UNC_NAME,
      fire: named(UNC_NAME),
    },
  ];
}

// The paths a message must never show, as created and as resolved (D-26: nothing is removed first).
function forbiddenTexts(): [string, string][] {
  return [
    ["the temp root", root],
    ["the sibling temp root", sibling],
    [
      "the temp root as mkdtemp spelled it",
      path.join(os.tmpdir(), path.basename(root)),
    ],
    ["os.tmpdir()", os.tmpdir()],
    ["the real path of os.tmpdir()", realTmp],
    ["process.cwd()", process.cwd()],
    ["the fixtures directory", FIXTURES],
    ["a require stack", "Require stack"],
  ];
}

function expectNoPath(error: ReactAdapterError, label: string): void {
  for (const [what, text] of forbiddenTexts()) {
    expect(
      error.message.includes(text),
      `${label} (${error.code}): the message contains ${what}: ${error.message}`
    ).toBe(false);
  }
  expect(
    /[\\/]react-adapter-messages-/.test(error.message),
    `${label} (${error.code}): the message contains a separator followed by the temp prefix: ${error.message}`
  ).toBe(false);
}

async function runCases(): Promise<
  { label: string; error: ReactAdapterError; entry: Case }[]
> {
  const done: { label: string; error: ReactAdapterError; entry: Case }[] = [];
  for (const entry of buildCases()) {
    vi.mocked(stat).mockReset();
    const outcome = await entry.fire();
    done.push({
      label: entry.label,
      error: expectAdapterError(outcome, entry.code),
      entry,
    });
  }
  return done;
}

describe("error messages carry no absolute path", () => {
  test("every published code is produced by at least one send and no message contains an absolute path (D-09, D-10, D-26)", async ({
    skip,
  }) => {
    // Outside CI makeLink reports false when links cannot be created; CI fails loudly instead.
    if (!linksWork) {
      skip("symlinks cannot be created on this host");
    }
    const done = await runCases();
    const seen = new Set(done.map(({ error }) => error.code));
    expect(seen).toEqual(new Set(Object.values(REACT_ADAPTER_ERROR_CODES)));
    for (const { label, error } of done) {
      expectNoPath(error, label);
    }
  });

  test("an absolute template name appears in a message only as its last path segment and stays whole on error.template (D-26)", async ({
    skip,
  }) => {
    if (!linksWork) {
      skip("symlinks cannot be created on this host");
    }
    const done = await runCases();
    const absoluteCases = done.filter(
      ({ entry }) => entry.absolute !== undefined
    );
    // Every named message site is covered with an absolute name.
    expect(absoluteCases.length).toBeGreaterThanOrEqual(12);
    // The two lookup sites really are the two failures they are named for.
    const causeOf = (fragment: string): unknown =>
      absoluteCases.find(({ label }) => label.includes(fragment))?.error.cause;
    expect(causeOf("lookup (realpath)")).toMatchObject({ code: "ELOOP" });
    expect(causeOf("lookup (stat)")).toMatchObject({ code: "EACCES" });
    for (const { label, error, entry } of absoluteCases) {
      const full = entry.absolute ?? "";
      expect(error.template, label).toBe(full);
      const last =
        full
          .split(/[\\/]/)
          .filter((part) => part !== "")
          .pop() ?? "";
      expect(error.message, `${label}: last segment`).toContain(
        JSON.stringify(last).slice(1, -1)
      );
      expect(
        error.message.includes(full),
        `${label}: full name in the message`
      ).toBe(false);
      expectNoPath(error, label);
    }
  });

  test("a pretty formatter failure fails once as RENDER_FAILED and writes no html (TEST-01)", async () => {
    prettyFailsOnce();
    const outcome = await compileTemplate(
      "welcome",
      inRoot(),
      new ReactAdapter({ pretty: true })
    );
    const error = expectAdapterError(
      outcome,
      REACT_ADAPTER_ERROR_CODES.RENDER_FAILED
    );
    expect(vi.mocked(pretty)).toHaveBeenCalledTimes(1);
    expect(error.cause).toBeInstanceOf(Error);
    expect(error.cause).toMatchObject({ message: "formatter boom" });
    expect(error.template).toBe("welcome");
    expect(error.path).toBe(path.join(root, "welcome.js"));
    expect(error.message).toContain("could not be formatted");
    expect(error.message).not.toContain("formatter boom");
    expectNoPath(error, "pretty failure");
    expect(outcome.html).toBeUndefined();
  });
});
