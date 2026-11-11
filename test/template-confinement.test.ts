import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { MailerOptions } from "@nestjs-modules/mailer";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { ReactAdapter } from "../src";
import type { ReactAdapterOptions } from "../src";
import { isInsideRoot, resolveRealLocation } from "../src/template.confine";
import { locateTemplate } from "../src/template.lookup";
import {
  compileOnce,
  compileTemplate,
  expectAdapterError,
  makeLink,
  writeTemplate,
} from "./helpers";
import type { Outcome } from "./helpers";

const OUTSIDE = "ERR_REACT_ADAPTER_TEMPLATE_OUTSIDE_ROOT";
const NOT_FOUND = "ERR_REACT_ADAPTER_TEMPLATE_NOT_FOUND";

// `base` is deliberately NOT realpath'd: on macOS os.tmpdir() sits under the /var -> /private/var
// alias, so local runs exercise an aliased spelling of every path below. `realBase` is its real path.
let base = "";
let realBase = "";
let linksOk = true;
const INVALID_NAME = "ERR_REACT_ADAPTER_INVALID_TEMPLATE_NAME";
const DIR_MISSING = "ERR_REACT_ADAPTER_TEMPLATE_DIR_MISSING";
const COUNTER_KEY = "__reactAdapterConfinementCounted";
let caseInsensitive = false;

const at = (...parts: string[]): string => path.join(base, ...parts);

function options(templateDir?: string, dirs?: string[]): MailerOptions {
  return { template: { dir: templateDir, dirs } };
}

function expectRendered(outcome: Outcome, marker: string): void {
  expect(outcome.calls).toBe(1);
  expect(outcome.threw).toBeUndefined();
  expect(outcome.early).toBe(false);
  expect(outcome.args).toEqual([]);
  expect(outcome.html).toEqual(expect.stringContaining(`${marker}:Body`));
}

async function put(relative: string, marker: string): Promise<void> {
  const file = at(relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await writeTemplate(file, marker);
}

async function link(
  target: string,
  linkPath: string,
  kind: "file" | "dir"
): Promise<void> {
  await fs.mkdir(path.dirname(linkPath), { recursive: true });
  const created = await makeLink(target, linkPath, kind);
  linksOk = linksOk && created;
}

beforeAll(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), "react-adapter-confine-"));
  realBase = await fs.realpath(base);

  await put("root/ok.js", "M-root-ok");
  await put("root/sub/x.js", "M-root-sub-x");
  await put("root/w.cjs", "M-root-w-cjs");
  await put("root/w2.js", "M-root-w2-js");
  await fs.writeFile(
    at("root", "not-component.js"),
    'module.exports = "text";\n'
  );
  await fs.writeFile(
    at("root", "throws-render.js"),
    'module.exports = function Template() { throw new Error("render boom"); };\n'
  );
  await fs.writeFile(
    at("root", "counted.js"),
    `globalThis[${JSON.stringify(COUNTER_KEY)}] = (globalThis[${JSON.stringify(COUNTER_KEY)}] ?? 0) + 1;
module.exports = function Template(props) { return "M-counted:" + props.body; };
`
  );
  await put("out/secret.js", "M-out-secret");
  await put("out/t.js", "M-out-t");
  await put("root-evil/evil.js", "M-root-evil");
  await put("b/b.js", "M-b-b");
  await put("b/shared/t.js", "M-b-shared-t");
  await put("b/shared/u.js", "M-b-shared-u");
  await fs.mkdir(at("root", "nested.js"), { recursive: true });
  await fs.mkdir(at("tree.js"), { recursive: true });

  await link(at("out"), at("root", "link-out"), "dir");
  await link(at("out"), at("root", "shared"), "dir");
  await link(at("out", "secret.js"), at("root", "link-out-file.js"), "file");
  await link(at("root", "sub", "x.js"), at("root", "link-in.js"), "file");
  await link(at("out", "missing.js"), at("root", "dangling-out.js"), "file");
  await link(at("root"), at("current"), "dir");
  await link(at("root"), at("alias"), "dir");
  await link(at("out", "secret.js"), at("root", "w.js"), "file");
  await link(at("out", "secret.js"), at("root", "w2.cjs"), "file");
  await link(at("root", "loop-b.js"), at("root", "loop-a.js"), "file");
  await link(at("root", "loop-a.js"), at("root", "loop-b.js"), "file");

  await fs.writeFile(at("case-probe.tmp"), "");
  caseInsensitive = await fs.stat(at("CASE-PROBE.TMP")).then(
    () => true,
    () => false
  );
});

afterAll(async () => {
  await fs.rm(base, { recursive: true, force: true, maxRetries: 3 });
});

// Skips the calling test, visibly, when this host could not create the symlink fixtures.
function needLinks(skip: (note?: string) => never): void {
  if (!linksOk) {
    skip("symlinks cannot be created on this host");
  }
}

describe("template confinement by real location", () => {
  test("a ../ escape is TEMPLATE_OUTSIDE_ROOT whether or not the target exists (D-01, D-03)", async () => {
    const rootDir = at("root");
    for (const name of ["../out/secret", "../out/nope"]) {
      const error = expectAdapterError(
        await compileTemplate(name, options(rootDir)),
        OUTSIDE
      );
      expect(error.template).toBe(name);
      expect(error.path).toBe(at("out", `${path.basename(name)}.js`));
      expect(error.roots).toEqual([path.resolve(rootDir)]);
      expect(error.searched).toBeUndefined();
    }
  });

  test("an absolute name outside every root is TEMPLATE_OUTSIDE_ROOT whether or not the file exists (D-01, D-02)", async () => {
    for (const name of [at("out", "secret.js"), at("out", "none.js")]) {
      const error = expectAdapterError(
        await compileTemplate(name, options(at("root"))),
        OUTSIDE
      );
      expect(error.template).toBe(name);
      expect(error.message).not.toContain(base);
      expect(error.message).not.toContain(realBase);
      expect(error.roots).toEqual([at("root")]);
    }
  });

  test("a name that stays inside through .. or . segments loads (D-03)", async () => {
    expectRendered(
      await compileTemplate("sub/../ok", options(at("root"))),
      "M-root-ok"
    );
    expectRendered(
      await compileTemplate("./ok", options(at("root"))),
      "M-root-ok"
    );
    expectRendered(
      await compileTemplate("sub//x", options(at("root"))),
      "M-root-sub-x"
    );
  });

  test("an absolute name inside a root loads through the root, its real path or an alias (D-02, D-17)", async ({
    skip,
  }) => {
    needLinks(skip);
    expectRendered(
      await compileTemplate(at("root", "ok.js"), options(at("root"))),
      "M-root-ok"
    );
    expectRendered(
      await compileTemplate(
        path.join(realBase, "root", "ok.js"),
        options(at("root"))
      ),
      "M-root-ok"
    );
    expectRendered(
      await compileTemplate(at("alias", "ok.js"), options(at("root"))),
      "M-root-ok"
    );
    expectRendered(
      await compileTemplate(at("root", "ok.js"), options(at("alias"))),
      "M-root-ok"
    );
  });

  test("letter case of a root or name is decided by the filesystem, not by the adapter (D-17)", async () => {
    if (caseInsensitive) {
      expectRendered(
        await compileTemplate("ok", options(at("ROOT"))),
        "M-root-ok"
      );
      expectRendered(
        await compileTemplate(at("root", "ok.js"), options(at("ROOT"))),
        "M-root-ok"
      );
      expectRendered(
        await compileTemplate(at("ROOT", "ok.js"), options(at("root"))),
        "M-root-ok"
      );
    } else {
      expectAdapterError(
        await compileTemplate("ok", options(at("ROOT"))),
        NOT_FOUND
      );
      expectAdapterError(
        await compileTemplate(at("ROOT", "ok.js"), options(at("root"))),
        OUTSIDE
      );
    }
  });

  test("a missing name inside a root is TEMPLATE_NOT_FOUND, not TEMPLATE_OUTSIDE_ROOT (D-17)", async () => {
    const error = expectAdapterError(
      await compileTemplate("nope", options(at("root"))),
      NOT_FOUND
    );
    expect(error.searched).toEqual([
      at("root", "nope.js"),
      at("root", "nope.cjs"),
      at("root", "nope.mjs"),
    ]);
  });

  test("a sibling directory that shares the root's name prefix is outside (edge SEC-01/adjacency)", async () => {
    const error = expectAdapterError(
      await compileTemplate("../root-evil/evil", options(at("root"))),
      OUTSIDE
    );
    expect(error.path).toBe(at("root-evil", "evil.js"));
    // A name equal to the root itself is inside the root but is a directory, not a regular file.
    expectAdapterError(
      await compileTemplate(at("tree.js"), options(at("tree.js"))),
      NOT_FOUND
    );
    expectAdapterError(
      await compileTemplate("nested.js", options(at("root"))),
      NOT_FOUND
    );
  });

  test("a symlink inside a root that points outside is refused, file and directory links alike (D-04, SEC-02)", async ({
    skip,
  }) => {
    needLinks(skip);
    const file = expectAdapterError(
      await compileTemplate("link-out-file", options(at("root"))),
      OUTSIDE
    );
    expect(file.path).toBe(at("root", "link-out-file.js"));
    const folder = expectAdapterError(
      await compileTemplate("link-out/secret", options(at("root"))),
      OUTSIDE
    );
    expect(folder.path).toBe(at("root", "link-out", "secret.js"));
  });

  test("a symlink that resolves inside the root loads (D-04)", async ({
    skip,
  }) => {
    needLinks(skip);
    expectRendered(
      await compileTemplate("link-in", options(at("root"))),
      "M-root-sub-x"
    );
  });

  test("a root that is itself a symlink works for relative and absolute names (D-04)", async ({
    skip,
  }) => {
    needLinks(skip);
    for (const name of ["ok", at("current", "ok.js"), at("root", "ok.js")]) {
      expectRendered(
        await compileTemplate(name, options(at("current"))),
        "M-root-ok"
      );
    }
  });

  test("an earlier root's escaping candidate does not hide a later root's file (D-24)", async ({
    skip,
  }) => {
    needLinks(skip);
    const both = options(at("root"), [at("b")]);
    expectRendered(await compileTemplate("shared/t", both), "M-b-shared-t");
    expectRendered(await compileTemplate("shared/u", both), "M-b-shared-u");
  });

  test("every configured root counts, and a file inside any of them is accepted (D-07)", async () => {
    expectRendered(
      await compileTemplate("../b/b", options(at("root"), [at("b")])),
      "M-b-b"
    );
    const error = expectAdapterError(
      await compileTemplate("../b/b", options(at("root"))),
      OUTSIDE
    );
    expect(error.path).toBe(at("b", "b.js"));
  });

  test("a missing root contributes nothing that can load and reports TEMPLATE_NOT_FOUND (edge SEC-01/empty)", async () => {
    expectRendered(
      await compileTemplate("ok", options(at("missing"), [at("root")])),
      "M-root-ok"
    );
    expectAdapterError(
      await compileTemplate("ok", options(at("missing"))),
      NOT_FOUND
    );
    expectRendered(
      await compileTemplate("ok", options(at("root"), [])),
      "M-root-ok"
    );
    // With template.dirs empty the single root alone confines.
    expectAdapterError(
      await compileTemplate("../b/b", options(at("root"), [])),
      OUTSIDE
    );
  });

  test("a dangling symlink inside a root is TEMPLATE_NOT_FOUND (accepted planter-only exception, D-25)", async ({
    skip,
  }) => {
    needLinks(skip);
    // D-25 and threat T-03-11: a link INSIDE the root whose target is missing reads as a plain miss, while the
    // same shape with an existing outside target is refused. Only someone who can already write into the
    // template folder can observe the difference, so no code closes it.
    expectAdapterError(
      await compileTemplate("dangling-out", options(at("root"))),
      NOT_FOUND
    );
    expectAdapterError(
      await compileTemplate("link-out-file", options(at("root"))),
      OUTSIDE
    );
  });

  test("an outside candidate is skipped and the first inside regular file in lookup order loads (D-24, edge SEC-01/ordering)", async ({
    skip,
  }) => {
    needLinks(skip);
    // root/w.js is a link out (skipped) beside a regular root/w.cjs.
    expectRendered(
      await compileTemplate("w", options(at("root"))),
      "M-root-w-cjs"
    );
    // root/w2.js is regular and comes before the root/w2.cjs link out.
    expectRendered(
      await compileTemplate("w2", options(at("root"))),
      "M-root-w2-js"
    );
  });

  test("an escape with no inside file is TEMPLATE_OUTSIDE_ROOT, never TEMPLATE_NOT_FOUND (D-24)", async ({
    skip,
  }) => {
    needLinks(skip);
    const roots = [at("root"), at("b")];
    for (const name of ["secret", "nope"]) {
      const error = expectAdapterError(
        await compileTemplate(
          `link-out/${name}`,
          options(roots[0], [roots[1]])
        ),
        OUTSIDE
      );
      expect(error.path).toBe(at("root", "link-out", `${name}.js`));
      expect(error.roots).toEqual(roots);
    }
  });

  test("names are compared as the filesystem stores them: no decoding, folding or normalising (edge SEC-01/encoding)", async () => {
    expectAdapterError(
      await compileTemplate("%2e%2e%2fout%2fsecret", options(at("root"))),
      NOT_FOUND
    );
    const backslashed = await compileTemplate(
      "..\\out\\secret",
      options(at("root"))
    );
    if (process.platform === "win32") {
      expectAdapterError(backslashed, OUTSIDE);
    } else {
      expectAdapterError(backslashed, NOT_FOUND);
    }
  });

  test("concurrent sends of an escaping and an inside name each get their own outcome (edge SEC-01/concurrency)", async () => {
    const [escaping, inside] = await Promise.all([
      compileTemplate("../out/secret", options(at("root"))),
      compileTemplate("ok", options(at("root"))),
    ]);
    expectAdapterError(escaping, OUTSIDE);
    expectRendered(inside, "M-root-ok");
  });

  test("resolveRealLocation returns the real path for existing files and the deepest resolvable ancestor plus the tail for missing ones", async ({
    skip,
  }) => {
    needLinks(skip);
    const real = (...parts: string[]): string => path.join(realBase, ...parts);
    expect(await resolveRealLocation(at("alias", "ok.js"))).toEqual({
      location: real("root", "ok.js"),
      failure: undefined,
    });
    expect(await resolveRealLocation(at("root", "nope.js"))).toEqual({
      location: real("root", "nope.js"),
      failure: undefined,
    });
    expect(
      await resolveRealLocation(at("alias", "no", "such", "x.js"))
    ).toEqual({
      location: real("root", "no", "such", "x.js"),
      failure: undefined,
    });
    // A path below a regular file is ENOTDIR: a miss, not a failure.
    expect(await resolveRealLocation(at("root", "ok.js", "x.js"))).toEqual({
      location: real("root", "ok.js", "x.js"),
      failure: undefined,
    });
    const looped = await resolveRealLocation(at("root", "loop-a.js"));
    expect(looped.location).toBe(real("root", "loop-a.js"));
    expect(looped.failure?.cause).toMatchObject({ code: "ELOOP" });
  });

  test("the verified real path is the loaded path: error.path is the real path on INVALID_EXPORT and RENDER_FAILED (D-22)", async ({
    skip,
  }) => {
    needLinks(skip);
    const viaLink = options(at("current"));
    const invalid = expectAdapterError(
      await compileTemplate("not-component", viaLink),
      "ERR_REACT_ADAPTER_INVALID_EXPORT"
    );
    expect(invalid.path).toBe(path.join(realBase, "root", "not-component.js"));
    const render = expectAdapterError(
      await compileTemplate("throws-render", viaLink),
      "ERR_REACT_ADAPTER_RENDER_FAILED"
    );
    expect(render.path).toBe(path.join(realBase, "root", "throws-render.js"));
  });

  test("a template reached through a symlinked root and through its real path is evaluated once", async ({
    skip,
  }) => {
    needLinks(skip);
    Reflect.deleteProperty(globalThis, COUNTER_KEY);
    try {
      expectRendered(
        await compileTemplate("counted", options(at("current"))),
        "M-counted"
      );
      expectRendered(
        await compileTemplate("counted", options(path.join(realBase, "root"))),
        "M-counted"
      );
      expectRendered(
        await compileTemplate("counted", options(at("root"))),
        "M-counted"
      );
      expect(Reflect.get(globalThis, COUNTER_KEY)).toBe(1);
    } finally {
      Reflect.deleteProperty(globalThis, COUNTER_KEY);
    }
  });

  test.each([
    ["/a/b", "/a/b/c.js", true],
    ["/a/b", "/a/bc/c.js", false],
    ["/a/b", "/a/b", true],
    ["/a/b", "/a/b/..hidden.js", true],
    ["/a/b", "/a", false],
    ["/", "/x", true],
    ["/a/b/", "/a/b/c", true],
  ])("isInsideRoot (posix) %s contains %s: %s", (root, candidate, expected) => {
    expect(isInsideRoot(root, candidate, path.posix)).toBe(expected);
  });

  test.each([
    ["C:\\a\\b", "D:\\a\\b\\c.js", false],
    ["C:\\a\\b", "c:\\A\\B\\c.js", true],
    ["\\\\srv\\sh\\r", "\\\\SRV\\sh\\r\\x.js", true],
    ["\\\\srv\\sh\\r", "\\\\srv\\sh\\other\\x.js", false],
  ])("isInsideRoot (win32) %s contains %s: %s", (root, candidate, expected) => {
    expect(isInsideRoot(root, candidate, path.win32)).toBe(expected);
  });
});

// A JavaScript caller can hand compile() undefined mailer options; the type forbids it, so this one
// constant models that caller. It is the only double assertion in this phase.
const NO_MAILER_OPTIONS = undefined as unknown as MailerOptions;

const OPTED_OUT = (): ReactAdapter =>
  new ReactAdapter({ unsafeAllowOutsideTemplateDir: true });

// Mailer options that carry the opt-out's name in a place the adapter must ignore.
function misplacedOptions(place: string): MailerOptions {
  const rootDir = at("root");
  const loose: MailerOptions = {};
  const key = { unsafeAllowOutsideTemplateDir: true };
  switch (place) {
    case "template.options":
      Object.assign(loose, { template: { dir: rootDir, options: key } });
      break;
    case "template":
      Object.assign(loose, { template: { dir: rootDir, ...key } });
      break;
    case "top level":
      Object.assign(loose, { template: { dir: rootDir }, ...key });
      break;
    default:
      Object.assign(loose, { template: { dir: rootDir }, options: key });
  }
  return loose;
}

describe("unsafeAllowOutsideTemplateDir (D-11, D-12, D-13, D-19)", () => {
  test("with the opt-out an absolute name outside, ../ and a symlink out load as in 0.2.x (D-11)", async ({
    skip,
  }) => {
    needLinks(skip);
    const viaRoot = options(at("root"));
    for (const name of [
      "../out/secret",
      at("out", "secret.js"),
      "link-out-file",
    ]) {
      expectRendered(
        await compileTemplate(name, viaRoot, OPTED_OUT()),
        "M-out-secret"
      );
    }
  });

  test("NUL, URL-scheme and verbatim device names stay INVALID_TEMPLATE_NAME with the opt-out on every OS (D-11)", async () => {
    for (const name of ["ok\0", "file:x", "\\\\?\\C:\\x"]) {
      const outcome = await compileTemplate(
        name,
        options(at("root")),
        OPTED_OUT()
      );
      expectAdapterError(outcome, INVALID_NAME);
    }
  });

  test.skipIf(process.platform === "win32")(
    "drive-letter and UNC names stay INVALID_TEMPLATE_NAME with the opt-out off Windows (D-19)",
    async () => {
      for (const name of ["C:\\x", "//srv/sh/x"]) {
        const outcome = await compileTemplate(
          name,
          options(at("root")),
          OPTED_OUT()
        );
        expectAdapterError(outcome, INVALID_NAME);
      }
    }
  );

  test("the key in template.options, template, the top level, the options bag, mail.data or context does not enable it (D-12)", async () => {
    for (const place of [
      "template.options",
      "template",
      "top level",
      "options bag",
    ]) {
      expectAdapterError(
        await compileTemplate("../out/secret", misplacedOptions(place)),
        OUTSIDE
      );
    }
    for (const data of [
      { unsafeAllowOutsideTemplateDir: true, context: { body: "Body" } },
      { context: { body: "Body", unsafeAllowOutsideTemplateDir: true } },
    ]) {
      const mail = {
        data: {
          template: "../out/secret",
          html: undefined as unknown,
          ...data,
        },
      };
      expectAdapterError(
        await compileOnce(new ReactAdapter(), mail, options(at("root"))),
        OUTSIDE
      );
    }
  });

  test("constructor values other than the literal true do not enable it (D-12)", async () => {
    for (const value of ["true", 1, {}]) {
      const loose: ReactAdapterOptions = {};
      Object.assign(loose, { unsafeAllowOutsideTemplateDir: value });
      expectAdapterError(
        await compileTemplate(
          "../out/secret",
          options(at("root")),
          new ReactAdapter(loose)
        ),
        OUTSIDE
      );
    }
  });

  test("an unsafeAllowOutsideTemplateDir inherited from Object.prototype does not enable it, with no argument or with {} (D-12)", async () => {
    const key = "unsafeAllowOutsideTemplateDir";
    expect(
      Reflect.defineProperty(Object.prototype, key, {
        value: true,
        configurable: true,
        writable: true,
        enumerable: false,
      })
    ).toBe(true);
    try {
      for (const adapter of [new ReactAdapter(), new ReactAdapter({})]) {
        expectAdapterError(
          await compileTemplate("../out/secret", options(at("root")), adapter),
          OUTSIDE
        );
      }
    } finally {
      Reflect.deleteProperty(Object.prototype, key);
      expect(Reflect.has(Object.prototype, key)).toBe(false);
    }
  });

  test("constructing with the opt-out and rendering outside a root never warns or logs (D-13)", async () => {
    const spies = [
      vi.spyOn(process, "emitWarning").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
      vi.spyOn(console, "log").mockImplementation(() => undefined),
    ];
    try {
      expectRendered(
        await compileTemplate(
          "../out/secret",
          options(at("root")),
          OPTED_OUT()
        ),
        "M-out-secret"
      );
      for (const spy of spies) {
        expect(spy).not.toHaveBeenCalled();
      }
    } finally {
      for (const spy of spies) {
        spy.mockRestore();
      }
    }
  });

  test("compile() with undefined mailer options: a relative name is DIR_MISSING and an absolute name is OUTSIDE_ROOT unless opted out", async () => {
    const mail = (template: string) => ({
      data: { template, context: { body: "Body" }, html: undefined as unknown },
    });
    expectAdapterError(
      await compileOnce(new ReactAdapter(), mail("ok"), NO_MAILER_OPTIONS),
      DIR_MISSING
    );
    const absolute = at("root", "ok.js");
    const refused = expectAdapterError(
      await compileOnce(new ReactAdapter(), mail(absolute), NO_MAILER_OPTIONS),
      OUTSIDE
    );
    expect(refused.roots).toEqual([]);
    expectRendered(
      await compileOnce(OPTED_OUT(), mail(absolute), NO_MAILER_OPTIONS),
      "M-root-ok"
    );
  });

  test("every file locateTemplate returns lies inside a configured root unless the opt-out is on", async ({
    skip,
  }) => {
    needLinks(skip);
    const roots = [at("root")];
    const both = [at("root"), at("b")];
    const loading: [string, string[], string | undefined][] = [
      ["ok", roots, undefined],
      ["sub/../ok", roots, undefined],
      ["link-in", roots, undefined],
      ["w", roots, path.join(realBase, "root", "w.cjs")],
      ["w2", roots, undefined],
      [at("root", "ok.js"), roots, undefined],
      [path.join(realBase, "root", "ok.js"), roots, undefined],
      [at("alias", "ok.js"), roots, undefined],
      ["../b/b", both, path.join(realBase, "b", "b.js")],
      ["shared/t", both, path.join(realBase, "b", "shared", "t.js")],
    ];
    const escaping = [
      "../out/secret",
      at("out", "secret.js"),
      "link-out-file",
      "link-out/secret",
    ];
    const realRoots = await Promise.all(
      both.map((directory) => fs.realpath(directory))
    );
    const inside = (file: string): boolean =>
      realRoots.some((realRoot) => {
        const relative = path.relative(realRoot, file);
        return (
          relative !== "" &&
          !relative.startsWith("..") &&
          !path.isAbsolute(relative)
        );
      });

    for (const [name, directories, expected] of loading) {
      const file = await locateTemplate(
        name,
        { dirs: directories },
        { allowOutside: false }
      );
      const real = await fs.realpath(file);
      expect(file, name).toBe(real);
      expect(inside(real), name).toBe(true);
      if (expected !== undefined) {
        expect(real, name).toBe(expected);
      }
    }
    for (const name of escaping) {
      await expect(
        locateTemplate(name, { dirs: roots }, { allowOutside: false })
      ).rejects.toMatchObject({ code: OUTSIDE });
      const file = await locateTemplate(
        name,
        { dirs: roots },
        { allowOutside: true }
      );
      expect(inside(await fs.realpath(file)), name).toBe(false);
    }
  });

  test.runIf(process.platform === "win32")(
    "a drive-letter absolute name inside a root loads and one outside every root is TEMPLATE_OUTSIDE_ROOT (D-05 exception)",
    async () => {
      expectRendered(
        await compileTemplate(at("root", "ok.js"), options(at("root"))),
        "M-root-ok"
      );
      expectAdapterError(
        await compileTemplate(at("out", "secret.js"), options(at("root"))),
        OUTSIDE
      );
    }
  );
});
