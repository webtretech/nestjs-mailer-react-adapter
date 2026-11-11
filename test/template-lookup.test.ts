import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { MailerOptions } from "@nestjs-modules/mailer";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { REACT_ADAPTER_ERROR_CODES, ReactAdapter } from "../src";
import { compileTemplate, expectAdapterError, writeTemplate } from "./helpers";
import type { Outcome } from "./helpers";

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures"
);

const EXTENSIONS = [".js", ".cjs", ".mjs"];

let root = "";
const dir = (name: string): string => path.join(root, name);

function options(templateDir?: string, dirs?: string[]): MailerOptions {
  return { template: { dir: templateDir, dirs } };
}

// Builds options whose template.dirs holds a value the MailerOptions type would reject.
function looseOptions(templateDir: string | undefined, dirs: unknown) {
  const loose: MailerOptions = {};
  Object.assign(loose, { template: { dir: templateDir, dirs } });
  return loose;
}

function expectRendered(outcome: Outcome, marker: string): void {
  expect(outcome.calls).toBe(1);
  expect(outcome.threw).toBeUndefined();
  expect(outcome.early).toBe(false);
  expect(outcome.args).toEqual([]);
  expect(outcome.html).toEqual(expect.stringContaining(`${marker}:Body`));
}

function candidates(directory: string, name: string): string[] {
  return EXTENSIONS.map((extension) => path.join(directory, name + extension));
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "react-adapter-lookup-"));
  for (const name of [
    "base",
    "base/nested/deep",
    "base/isdir.js",
    "empty",
    "primary",
    "a",
    "b",
    "late",
  ]) {
    await fs.mkdir(dir(name), { recursive: true });
  }
  const files: Record<string, string> = {
    "base/all3.js": "all3-js",
    "base/all3.cjs": "all3-cjs",
    "base/all3.mjs": "all3-mjs",
    "base/cm.cjs": "cm-cjs",
    "base/cm.mjs": "cm-mjs",
    "base/om.mjs": "om-mjs",
    "base/dotted.v2.js": "dotted-v2",
    "base/esm.mjs": "esm-exact",
    "base/esm.mjs.js": "esm-decoy",
    "base/welcome.v2.mjs": "wv2-exact",
    "base/welcome.v2.mjs.js": "wv2-decoy",
    "base/release.2026.11.js": "release",
    "base/x.tsx.js": "x-tsx-js",
    "base/welcome.JS.js": "upper-js",
    "base/isdir.cjs": "isdir-cjs",
    "base/nested/deep/welcome.js": "nested-deep",
    "primary/both.js": "both-primary",
    "a/both.js": "both-a",
    "b/only-b.js": "only-b",
    "a/order.js": "order-a",
    "b/order.js": "order-b",
    "primary/extorder.mjs": "extorder-primary-mjs",
    "a/extorder.js": "extorder-a-js",
    "a/in-a.js": "in-a",
    "b/welcome.js": "welcome-b",
  };
  for (const [file, marker] of Object.entries(files)) {
    await writeTemplate(dir(file), marker);
  }
  // A regular (non-JS) file whose name matches the raw template name must not be loaded.
  await fs.writeFile(dir("base/x.tsx"), "not a module");
  // A regular file used as a template.dirs entry: stat on a path below it fails with ENOTDIR.
  await fs.writeFile(dir("afile"), "not a directory");
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("extension order within one directory (D-17, D-18)", () => {
  test("welcome.js wins when .js, .cjs and .mjs all exist", async () => {
    expectRendered(
      await compileTemplate("all3", options(dir("base"))),
      "all3-js"
    );
  });

  test("welcome.cjs wins when only .cjs and .mjs exist", async () => {
    expectRendered(await compileTemplate("cm", options(dir("base"))), "cm-cjs");
  });

  test("welcome.mjs loads when it is the only candidate", async () => {
    expectRendered(await compileTemplate("om", options(dir("base"))), "om-mjs");
  });
});

describe("known-extension rule (D-17, TMPL-01)", () => {
  test("dotted.v2 loads dotted.v2.js", async () => {
    expectRendered(
      await compileTemplate("dotted.v2", options(dir("base"))),
      "dotted-v2"
    );
  });

  test("an explicit .mjs loads exactly that file, never name.mjs.js", async () => {
    expectRendered(
      await compileTemplate("esm.mjs", options(dir("base"))),
      "esm-exact"
    );
    expectRendered(
      await compileTemplate("welcome.v2.mjs", options(dir("base"))),
      "wv2-exact"
    );
  });

  test("an unknown suffix gets the extensions appended, not replaced", async () => {
    expectRendered(
      await compileTemplate("x.tsx", options(dir("base"))),
      "x-tsx-js"
    );
    expectRendered(
      await compileTemplate("release.2026.11", options(dir("base"))),
      "release"
    );
  });

  test.each(["x.json", "x.jsx", "x.tsx", "x.mjs.bak", "welcome.JS"])(
    "%s searches the name with .js, .cjs, .mjs appended",
    async (name) => {
      const error = expectAdapterError(
        await compileTemplate(name, options(dir("empty"))),
        "ERR_REACT_ADAPTER_TEMPLATE_NOT_FOUND"
      );
      expect(error.searched).toEqual(candidates(dir("empty"), name));
      expect(error.path).toBe(candidates(dir("empty"), name)[0]);
    }
  );

  test("the known-extension check is case-sensitive and never case-folds", async () => {
    expectRendered(
      await compileTemplate("welcome.JS", options(dir("base"))),
      "upper-js"
    );
  });

  test("release.2026.11 keeps every dotted part in the first candidate", async () => {
    const error = expectAdapterError(
      await compileTemplate("release.2026.12", options(dir("base"))),
      "ERR_REACT_ADAPTER_TEMPLATE_NOT_FOUND"
    );
    expect(error.searched?.[0]).toBe(dir("base/release.2026.12.js"));
  });
});

describe("nested names (TMPL-02)", () => {
  test("esm-pkg/welcome resolves inside the template root", async () => {
    const outcome = await compileTemplate("esm-pkg/welcome", options(FIXTURES));
    expect(outcome.calls).toBe(1);
    expect(outcome.threw).toBeUndefined();
    expect(outcome.args).toEqual([]);
    expect(outcome.html).toEqual(
      expect.stringContaining("<h1>esm-pkg-welcome</h1>")
    );
  });

  test("nested/deep/welcome and nested//deep/welcome find the same file", async () => {
    expectRendered(
      await compileTemplate("nested/deep/welcome", options(dir("base"))),
      "nested-deep"
    );
    expectRendered(
      await compileTemplate("nested//deep/welcome", options(dir("base"))),
      "nested-deep"
    );
  });

  test("a trailing slash fails as TEMPLATE_NOT_FOUND with its searched paths", async () => {
    const error = expectAdapterError(
      await compileTemplate("nested/", options(dir("base"))),
      "ERR_REACT_ADAPTER_TEMPLATE_NOT_FOUND"
    );
    expect(error.searched).toHaveLength(3);
    for (const searched of error.searched ?? []) {
      expect(searched.startsWith(dir("base"))).toBe(true);
    }
  });
});

describe("directory order (D-19, TMPL-03)", () => {
  test("template.dir wins over a template.dirs entry", async () => {
    expectRendered(
      await compileTemplate("both", options(dir("primary"), [dir("a")])),
      "both-primary"
    );
  });

  test("a template only in a later template.dirs entry is found there", async () => {
    expectRendered(
      await compileTemplate(
        "only-b",
        options(dir("primary"), [dir("a"), dir("b")])
      ),
      "only-b"
    );
  });

  test("the earlier template.dirs entry wins", async () => {
    expectRendered(
      await compileTemplate(
        "order",
        options(dir("primary"), [dir("a"), dir("b")])
      ),
      "order-a"
    );
    expectRendered(
      await compileTemplate(
        "order",
        options(dir("primary"), [dir("b"), dir("a")])
      ),
      "order-b"
    );
  });

  test("all extensions in one directory are tried before the next directory", async () => {
    expectRendered(
      await compileTemplate("extorder", options(dir("primary"), [dir("a")])),
      "extorder-primary-mjs"
    );
  });

  test("not-found searched order is dir then dirs, three extensions each", async () => {
    const error = expectAdapterError(
      await compileTemplate(
        "nope",
        options(dir("primary"), [dir("a"), dir("b")])
      ),
      "ERR_REACT_ADAPTER_TEMPLATE_NOT_FOUND"
    );
    expect(error.searched).toEqual([
      ...candidates(dir("primary"), "nope"),
      ...candidates(dir("a"), "nope"),
      ...candidates(dir("b"), "nope"),
    ]);
    expect(error.path).toBe(dir("primary/nope.js"));
    expect(error.template).toBe("nope");
  });

  test("template.dir repeated in template.dirs, or a repeated entry, is listed once", async () => {
    const error = expectAdapterError(
      await compileTemplate(
        "nope",
        options(dir("primary"), [dir("primary"), dir("a"), dir("a")])
      ),
      "ERR_REACT_ADAPTER_TEMPLATE_NOT_FOUND"
    );
    expect(error.searched).toEqual([
      ...candidates(dir("primary"), "nope"),
      ...candidates(dir("a"), "nope"),
    ]);
  });

  test("template.dir alone, with dirs absent or empty, lists exactly three candidates", async () => {
    for (const dirs of [undefined, []]) {
      const error = expectAdapterError(
        await compileTemplate("nope", options(dir("primary"), dirs)),
        "ERR_REACT_ADAPTER_TEMPLATE_NOT_FOUND"
      );
      expect(error.searched).toEqual(candidates(dir("primary"), "nope"));
    }
  });

  test("a directory named like a candidate is skipped for the real file", async () => {
    expectRendered(
      await compileTemplate("isdir", options(dir("base"))),
      "isdir-cjs"
    );
  });

  test("a template.dirs entry that is a regular file is skipped", async () => {
    expectRendered(
      await compileTemplate(
        "welcome",
        options(dir("empty"), [dir("afile"), dir("b")])
      ),
      "welcome-b"
    );
  });
});

describe("no template directory at all (D-27)", () => {
  test("a relative name with neither dir nor dirs is TEMPLATE_DIR_MISSING with no searched list", async () => {
    const error = expectAdapterError(
      await compileTemplate("welcome", {}),
      "ERR_REACT_ADAPTER_TEMPLATE_DIR_MISSING"
    );
    expect(error.template).toBe("welcome");
    expect(error.searched).toBeUndefined();
  });

  test("template.dir missing with template.dirs set searches dirs only", async () => {
    expectRendered(
      await compileTemplate("in-a", options(undefined, [dir("a")])),
      "in-a"
    );
    const error = expectAdapterError(
      await compileTemplate("nope", options(undefined, [dir("a")])),
      "ERR_REACT_ADAPTER_TEMPLATE_NOT_FOUND"
    );
    expect(error.searched).toEqual(candidates(dir("a"), "nope"));
  });

  test("an absolute name with no template.dir still renders", async () => {
    expectRendered(await compileTemplate(dir("base/all3.js"), {}), "all3-js");
    expectRendered(await compileTemplate(dir("base/cm"), {}), "cm-cjs");
  });

  test("template.dirs that is not an array, or holds non-strings and empty strings, never throws", async () => {
    for (const dirs of [
      "not-an-array",
      42,
      null,
      { 0: dir("a") },
      [1, null, "", {}, undefined],
    ]) {
      expectRendered(
        await compileTemplate("all3", looseOptions(dir("base"), dirs)),
        "all3-js"
      );
      const missing = expectAdapterError(
        await compileTemplate("all3", looseOptions(undefined, dirs)),
        "ERR_REACT_ADAPTER_TEMPLATE_DIR_MISSING"
      );
      expect(missing.searched).toBeUndefined();
    }
  });
});

describe("names, codes and failures", () => {
  test("error.template is the exact string passed in, with no normalization", async () => {
    for (const name of ["  spaced ", "Café", "CAFÉ", "café"]) {
      const error = expectAdapterError(
        await compileTemplate(name, options(dir("empty"))),
        "ERR_REACT_ADAPTER_TEMPLATE_NOT_FOUND"
      );
      expect(error.template).toBe(name);
      expect(error.searched).toEqual(candidates(dir("empty"), name));
    }
  });

  test("every published code is an exact ASCII ERR_REACT_ADAPTER_ string", () => {
    const codes = Object.values(REACT_ADAPTER_ERROR_CODES);
    expect(codes).toHaveLength(10);
    for (const code of codes) {
      expect(code).toMatch(/^ERR_REACT_ADAPTER_[A-Z_]+$/);
    }
    expect(new Set(codes).size).toBe(10);
  });

  test("a stat failure other than not-here is TEMPLATE_LOAD_FAILED with the cause", async () => {
    const name = "a".repeat(5000);
    const error = expectAdapterError(
      await compileTemplate(name, options(dir("empty"))),
      "ERR_REACT_ADAPTER_TEMPLATE_LOAD_FAILED"
    );
    expect(error.template).toBe(name);
    expect(error.path).toBe(path.resolve(dir("empty"), name + ".js"));
    expect(error.cause).toBeInstanceOf(Error);
  });

  test("lookup keeps no cache: a template created after a failed send renders on the next send", async () => {
    const first = await compileTemplate(
      "late-arrival",
      options(undefined, [dir("late")])
    );
    expectAdapterError(first, "ERR_REACT_ADAPTER_TEMPLATE_NOT_FOUND");
    await writeTemplate(dir("late/late-arrival.js"), "late-arrival");
    expectRendered(
      await compileTemplate("late-arrival", options(undefined, [dir("late")])),
      "late-arrival"
    );
  });

  test("concurrent compile() calls for different templates each get their own outcome", async () => {
    const adapter = new ReactAdapter();
    const [hit, miss, other] = await Promise.all([
      compileTemplate("all3", options(dir("base")), adapter),
      compileTemplate("nope", options(dir("base")), adapter),
      compileTemplate("cm", options(dir("base")), adapter),
    ]);
    expectRendered(hit, "all3-js");
    expectAdapterError(miss, "ERR_REACT_ADAPTER_TEMPLATE_NOT_FOUND");
    expectRendered(other, "cm-cjs");
  });

  test("compile() with an empty mailer options object and a relative name never throws", async () => {
    const outcome = await compileTemplate("welcome", {});
    expect(outcome.threw).toBeUndefined();
    expect(outcome.early).toBe(false);
    expect(outcome.calls).toBe(1);
  });

  // Phase 1 IN-08, second half, considered: the two-handler tail is kept, so the adapter error is not re-delivered.
  test("a callback that throws on the not-found path is called once and its throw becomes an unhandled rejection", async () => {
    const thrown = new Error("callback failed on the failure path");
    const mail = {
      data: { template: "nope", context: { body: "Body" }, html: undefined },
    };
    // Vitest fails the run on an unhandled rejection, so detach its listeners while this test captures one.
    const saved = process.rawListeners(
      "unhandledRejection"
    ) as NodeJS.UnhandledRejectionListener[];
    process.removeAllListeners("unhandledRejection");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      let calls = 0;
      let received: unknown;
      let onSecondCall: () => void = () => {};
      const secondCall = new Promise<"second call">((resolve) => {
        onSecondCall = () => resolve("second call");
      });
      const rejection = new Promise<unknown>((resolve) => {
        process.once("unhandledRejection", resolve);
      });
      const timeout = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), 2000);
      });
      new ReactAdapter().compile(
        mail,
        (...args: unknown[]) => {
          calls += 1;
          if (calls === 1) {
            [received] = args;
            throw thrown;
          }
          onSecondCall();
        },
        options(dir("base"))
      );
      const settled = await Promise.race([rejection, secondCall, timeout]);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(calls).toBe(1);
      expect(settled).toBe(thrown);
      expect(received).toMatchObject({
        code: "ERR_REACT_ADAPTER_TEMPLATE_NOT_FOUND",
      });
      expect(mail.data.html).toBeUndefined();
    } finally {
      clearTimeout(timer);
      process.removeAllListeners("unhandledRejection");
      for (const listener of saved) {
        process.on("unhandledRejection", listener);
      }
    }
  });
});
