import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { ReactAdapter, ReactAdapterError } from "../src";
import {
  compileOnce,
  compileTemplate,
  expectAdapterError,
  isCiEnvironment,
  makeLink,
  makeTempRoot,
  writeTemplate,
} from "./helpers";

// Templates are generated, so react is required by absolute path from outside the temp directory.
const REACT = createRequire(import.meta.url).resolve("react");

let dir: string;

beforeAll(async () => {
  dir = await makeTempRoot("react-adapter-loader-");
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function send(template: string): ReturnType<typeof compileTemplate> {
  return compileTemplate(template, { template: { dir } });
}

async function write(file: string, source: string): Promise<string> {
  const full = path.join(dir, file);
  await fs.writeFile(full, source);
  return full;
}

describe("template-loader: component shapes", () => {
  test("template-loader: a memo() default export renders", async () => {
    await write(
      "memo.js",
      `const React = require(${JSON.stringify(REACT)});
function Fn(props) { return React.createElement("p", null, "memo:" + props.body); }
module.exports = React.memo(Fn);
`
    );
    const outcome = await send("memo");
    expect(outcome.calls).toBe(1);
    expect(outcome.args).toEqual([]);
    expect(outcome.html).toContain("<p>memo:Body</p>");
  });

  test("template-loader: a forwardRef() default export renders", async () => {
    await write(
      "forward.js",
      `const React = require(${JSON.stringify(REACT)});
module.exports = React.forwardRef(function Fn(props) { return React.createElement("p", null, "forward:" + props.body); });
`
    );
    const outcome = await send("forward");
    expect(outcome.calls).toBe(1);
    expect(outcome.args).toEqual([]);
    expect(outcome.html).toContain("<p>forward:Body</p>");
  });

  test.each([
    ["null", "null", "null"],
    ["div", JSON.stringify("div"), "a string"],
    ["42", "42", "a number"],
    ["object", "{ a: 1 }", "an object with keys [a]"],
    [
      "element",
      `require(${JSON.stringify(REACT)}).createElement("div")`,
      "a React element",
    ],
  ])(
    "template-loader: module.exports = %s fails once as INVALID_EXPORT saying what was found",
    async (name, expression, found) => {
      const template = `shape-${name}`;
      const file = await write(
        `${template}.js`,
        `module.exports = ${expression};\n`
      );
      const outcome = await send(template);
      const error = expectAdapterError(
        outcome,
        "ERR_REACT_ADAPTER_INVALID_EXPORT"
      );
      expect(error.template).toBe(template);
      expect(error.path).toBe(file);
      expect(error.message).toContain(found);
      expect(error.cause).toBeUndefined();
      expect(outcome.html).toBeUndefined();
    }
  );
});

describe("template-loader: load failures", () => {
  test("template-loader: a syntax error fails once as TEMPLATE_LOAD_FAILED with the SyntaxError as cause", async () => {
    const file = await write("syntax.js", "module.exports = function (\n");
    const outcome = await send("syntax");
    const error = expectAdapterError(
      outcome,
      "ERR_REACT_ADAPTER_TEMPLATE_LOAD_FAILED"
    );
    expect(error.template).toBe("syntax");
    expect(error.path).toBe(file);
    expect(error.cause).toBeInstanceOf(SyntaxError);
    expect(error.message).toContain("restart");
    expect(outcome.html).toBeUndefined();
  });

  test("template-loader: a CommonJS template that throws at load is retried on the next send once it is fixed", async () => {
    const file = await write(
      "throws-at-load.js",
      `throw new Error("load boom");\n`
    );
    const failed = await send("throws-at-load");
    const error = expectAdapterError(
      failed,
      "ERR_REACT_ADAPTER_TEMPLATE_LOAD_FAILED"
    );
    expect(error.path).toBe(file);
    expect(error.cause).toBeInstanceOf(Error);
    expect(error.cause).not.toBeInstanceOf(ReactAdapterError);
    expect(error.cause).toMatchObject({ message: "load boom" });

    await writeTemplate(file, "fixed");
    const fixed = await send("throws-at-load");
    expect(fixed.calls).toBe(1);
    expect(fixed.args).toEqual([]);
    expect(fixed.html).toContain("fixed:Body");
  });

  test("template-loader: a .cjs template whose dependency needs import() is not evaluated a second time", async () => {
    const key = "__reactAdapterCjsDependencyCounter";
    await write(
      "tla-dependency.mjs",
      `await Promise.resolve();\nexport default 1;\n`
    );
    const file = await write(
      "requires-tla.cjs",
      `globalThis[${JSON.stringify(key)}] = (globalThis[${JSON.stringify(key)}] ?? 0) + 1;
require("./tla-dependency.mjs");
module.exports = function Template() { return "never"; };
`
    );
    try {
      const outcome = await send("requires-tla.cjs");
      const error = expectAdapterError(
        outcome,
        "ERR_REACT_ADAPTER_TEMPLATE_LOAD_FAILED"
      );
      expect(error.path).toBe(file);
      expect(error.cause).toBeInstanceOf(Error);
      expect(Reflect.get(globalThis, key)).toBe(1);
    } finally {
      Reflect.deleteProperty(globalThis, key);
    }
  });

  test("template-loader: a missing dependency fails as TEMPLATE_LOAD_FAILED naming MODULE_NOT_FOUND and no path", async () => {
    const file = await write(
      "needs-missing-dependency.js",
      `require("./definitely-missing-dependency");\nmodule.exports = function Template() { return "never"; };\n`
    );
    const outcome = await send("needs-missing-dependency");
    const error = expectAdapterError(
      outcome,
      "ERR_REACT_ADAPTER_TEMPLATE_LOAD_FAILED"
    );
    expect(error.message).toContain("MODULE_NOT_FOUND");
    expect(error.message).toContain("restart");
    expect(error.message).not.toContain(dir);
    expect(error.message).not.toContain("Require stack");
    expect(error.cause).toMatchObject({ code: "MODULE_NOT_FOUND" });
    expect(error.path).toBe(file);
    expect(outcome.html).toBeUndefined();
  });

  test("template-loader: a syntax error's own message is quoted", async () => {
    await write("syntax-quoted.js", "module.exports = (\n");
    const outcome = await send("syntax-quoted");
    const error = expectAdapterError(
      outcome,
      "ERR_REACT_ADAPTER_TEMPLATE_LOAD_FAILED"
    );
    expect(error.cause).toBeInstanceOf(SyntaxError);
    if (error.cause instanceof Error) {
      expect(error.cause.message).not.toBe("");
      expect(error.message).toContain(error.cause.message);
    }
    expect(error.message).not.toContain(dir);
  });

  test("template-loader: an error thrown at load without a code is quoted", async () => {
    await write("throws-own-boom.js", `throw new Error("own boom");\n`);
    const outcome = await send("throws-own-boom");
    const error = expectAdapterError(
      outcome,
      "ERR_REACT_ADAPTER_TEMPLATE_LOAD_FAILED"
    );
    expect(error.message).toContain("own boom");
    expect(error.message).not.toContain(dir);
  });

  test("template-loader: a thrown error with a string code shows only the code", async () => {
    await write(
      "throws-coded.js",
      `const failure = new Error("secret text");\nfailure.code = "E_TEMPLATE";\nthrow failure;\n`
    );
    const outcome = await send("throws-coded");
    const error = expectAdapterError(
      outcome,
      "ERR_REACT_ADAPTER_TEMPLATE_LOAD_FAILED"
    );
    expect(error.message).toContain("E_TEMPLATE");
    expect(error.message).toContain("the underlying error is in cause");
    expect(error.message).not.toContain("secret text");
    expect(error.cause).toMatchObject({
      code: "E_TEMPLATE",
      message: "secret text",
    });
  });

  test("template-loader: a non-Error value thrown at load is quoted", async () => {
    await write("throws-string.js", `throw "plain string failure";\n`);
    const outcome = await send("throws-string");
    const error = expectAdapterError(
      outcome,
      "ERR_REACT_ADAPTER_TEMPLATE_LOAD_FAILED"
    );
    expect(error.message).toContain("plain string failure");
    expect(error.cause).toBe("plain string failure");
  });

  // The one place a message can carry an absolute path: text thrown by the template or its dependencies is
  // quoted as given, so a path inside that text is quoted too. Coded Node errors never reach it.
  test("template-loader: an uncoded Error whose text carries an absolute path is quoted, an exception to the no-path rule", async () => {
    await write(
      "throws-path-text.js",
      `throw new Error("bad config in " + __filename);\n`
    );
    const outcome = await send("throws-path-text");
    const error = expectAdapterError(
      outcome,
      "ERR_REACT_ADAPTER_TEMPLATE_LOAD_FAILED"
    );
    expect(error.cause).toBeInstanceOf(Error);
    if (error.cause instanceof Error) {
      const quoted = error.cause.message;
      expect(quoted.startsWith("bad config in ")).toBe(true);
      expect(path.isAbsolute(quoted.slice("bad config in ".length))).toBe(true);
      expect(error.message).toContain(quoted);
    }
    expect(error.message).not.toContain("the underlying error is in cause");
    expect(outcome.html).toBeUndefined();
  });
});

describe("template-loader: render failures", () => {
  test("template-loader: a component that throws while rendering fails once as RENDER_FAILED without leaking the context", async () => {
    const file = await write(
      "throws-at-render.js",
      `module.exports = function Template(props) { throw new Error("render boom " + props.body); };\n`
    );
    const secret = "s3cr3t-value";
    const mail = {
      data: {
        template: "throws-at-render",
        context: { body: secret },
        html: undefined as unknown,
      },
    };
    const second = await compileOnce(new ReactAdapter(), mail, {
      template: { dir },
    });
    const error = expectAdapterError(second, "ERR_REACT_ADAPTER_RENDER_FAILED");
    expect(error.template).toBe("throws-at-render");
    expect(error.path).toBe(file);
    expect(error.cause).not.toBeInstanceOf(ReactAdapterError);
    expect(error.cause).toBeInstanceOf(Error);
    if (error.cause instanceof Error) {
      expect(error.cause.message).toContain(secret);
    }
    expect(error.message).not.toContain(secret);
    expect(error.message).toContain("throws-at-render");
    expect(error.message).not.toContain(file);
    expect(second.html).toBeUndefined();
  });

  test("template-loader: a component that throws undefined fails as RENDER_FAILED and keeps an undefined cause", async () => {
    await write(
      "throws-undefined.js",
      `module.exports = function Template() { throw undefined; };\n`
    );
    const error = expectAdapterError(
      await send("throws-undefined"),
      "ERR_REACT_ADAPTER_RENDER_FAILED"
    );
    expect("cause" in error).toBe(true);
    expect(Object.hasOwn(error, "cause")).toBe(true);
    expect(error.cause).toBeUndefined();
  });
});

describe("template-loader: errors are raised once and never wrapped again", () => {
  test("template-loader: TEMPLATE_NOT_FOUND has no cause", async () => {
    const error = expectAdapterError(
      await send("no-such-template"),
      "ERR_REACT_ADAPTER_TEMPLATE_NOT_FOUND"
    );
    expect(error.cause).toBeUndefined();
  });

  test("template-loader: INVALID_EXPORT has no cause", async () => {
    await write("invalid-for-cause.js", "module.exports = 7;\n");
    const error = expectAdapterError(
      await send("invalid-for-cause"),
      "ERR_REACT_ADAPTER_INVALID_EXPORT"
    );
    expect(error.cause).toBeUndefined();
  });
});

// A stand-in for the adapter: the helper only calls compile().
function fakeAdapter(
  compile: (mail: unknown, callback: () => void) => void
): ReactAdapter {
  return { compile } as unknown as ReactAdapter;
}

describe("test helper compileOnce", () => {
  test("a synchronous throw of undefined is recorded as a throw", async () => {
    const outcome = await compileOnce(
      fakeAdapter(() => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw undefined;
      }),
      { data: {} },
      {}
    );
    expect(outcome.didThrow).toBe(true);
    expect(outcome.threw).toBeInstanceOf(Error);
    expect(outcome.calls).toBe(0);
  });

  test("a callback that runs after compile() returns is counted once and not early", async () => {
    const outcome = await compileOnce(
      fakeAdapter((_mail, callback) => {
        queueMicrotask(callback);
      }),
      { data: {} },
      {}
    );
    expect(outcome.didThrow).toBe(false);
    expect(outcome.threw).toBeUndefined();
    expect(outcome.calls).toBe(1);
    expect(outcome.early).toBe(false);
  });

  test("a second callback inside the window is counted", async () => {
    const outcome = await compileOnce(
      fakeAdapter((_mail, callback) => {
        queueMicrotask(callback);
        setTimeout(callback, 10);
      }),
      { data: {} },
      {}
    );
    expect(outcome.calls).toBe(2);
  });
});

describe("test helper makeLink", () => {
  test("a link inside a directory that does not exist rejects with the path and code, it is not skipped", async () => {
    const target = await write(
      "link-target-enoent.js",
      "module.exports = 1;\n"
    );
    const link = path.join(dir, "no-such-directory", "link.js");
    const error = await makeLink(target, link, "file").then(
      () => undefined,
      (failure: unknown) => failure
    );
    expect(error).toBeInstanceOf(Error);
    const message = error instanceof Error ? error.message : "";
    expect(message).toContain(link);
    expect(message).toContain("ENOENT");
  });

  test("a link path that already exists rejects with the path and code, it is not skipped", async () => {
    const target = await write(
      "link-target-eexist.js",
      "module.exports = 1;\n"
    );
    const link = await write("link-exists.js", "module.exports = 2;\n");
    const error = await makeLink(target, link, "file").then(
      () => undefined,
      (failure: unknown) => failure
    );
    expect(error).toBeInstanceOf(Error);
    const message = error instanceof Error ? error.message : "";
    expect(message).toContain(link);
    expect(message).toContain("EEXIST");
  });

  // CI throws on any link failure, so the skip behaviour can only be observed off CI.
  test.skipIf(isCiEnvironment(process.env))(
    "a permission failure off CI skips instead of throwing",
    async () => {
      const symlink = vi
        .spyOn(fs, "symlink")
        .mockRejectedValue(
          Object.assign(new Error("denied"), { code: "EPERM" })
        );
      try {
        await expect(
          makeLink(path.join(dir, "a.js"), path.join(dir, "b.js"), "file")
        ).resolves.toBe(false);
      } finally {
        symlink.mockRestore();
      }
    }
  );

  test("CI is detected from GITHUB_ACTIONS or from a CI value that is not empty, 0 or false", () => {
    for (const env of [
      { CI: "true" },
      { CI: "1" },
      { CI: "yes" },
      { GITHUB_ACTIONS: "true" },
      { GITHUB_ACTIONS: "true", CI: "false" },
    ]) {
      expect(isCiEnvironment(env), JSON.stringify(env)).toBe(true);
    }
    for (const env of [
      {},
      { CI: "" },
      { CI: "0" },
      { CI: "false" },
      { CI: "FALSE" },
      { CI: "False" },
      { GITHUB_ACTIONS: "false" },
      { GITHUB_ACTIONS: "" },
    ]) {
      expect(isCiEnvironment(env), JSON.stringify(env)).toBe(false);
    }
  });
});
