import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { ReactAdapter, ReactAdapterError } from "../src";
import {
  compileOnce,
  compileTemplate,
  expectAdapterError,
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
  test("a memo() default export renders", async () => {
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

  test("a forwardRef() default export renders", async () => {
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
    "module.exports = %s fails once as INVALID_EXPORT saying what was found",
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
  test("a syntax error fails once as TEMPLATE_LOAD_FAILED with the SyntaxError as cause", async () => {
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

  test("a CommonJS template that throws at load is retried on the next send once it is fixed", async () => {
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

  test("a .cjs template whose dependency needs import() is not evaluated a second time", async () => {
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

  test("a missing dependency fails as TEMPLATE_LOAD_FAILED naming MODULE_NOT_FOUND and no path", async () => {
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

  test("a syntax error's own message is quoted", async () => {
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

  test("an error thrown at load without a code is quoted", async () => {
    await write("throws-own-boom.js", `throw new Error("own boom");\n`);
    const outcome = await send("throws-own-boom");
    const error = expectAdapterError(
      outcome,
      "ERR_REACT_ADAPTER_TEMPLATE_LOAD_FAILED"
    );
    expect(error.message).toContain("own boom");
    expect(error.message).not.toContain(dir);
  });

  test("a thrown error with a string code shows only the code", async () => {
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

  test("a non-Error value thrown at load is quoted", async () => {
    await write("throws-string.js", `throw "plain string failure";\n`);
    const outcome = await send("throws-string");
    const error = expectAdapterError(
      outcome,
      "ERR_REACT_ADAPTER_TEMPLATE_LOAD_FAILED"
    );
    expect(error.message).toContain("plain string failure");
    expect(error.cause).toBe("plain string failure");
  });

  // The thrown value is the template's, so describing it must not throw: each case below used to replace the
  // typed error with a bare TypeError (or kept a secondary error as the cause instead of the thrown value).
  test.each([
    {
      name: "a null-prototype object",
      source: "throw Object.create(null);",
      check: (cause: unknown) => {
        expect(Object.getPrototypeOf(cause)).toBeNull();
      },
    },
    {
      name: "an error whose message getter throws",
      source: `const failure = new Error("x");
Object.defineProperty(failure, "message", { get() { throw new Error("getter"); } });
throw failure;`,
      check: (cause: unknown) => {
        expect(cause).toBeInstanceOf(Error);
        expect(() => (cause as Error).message).toThrow("getter");
      },
    },
    {
      name: "an object whose code getter throws",
      source: `throw Object.defineProperty({}, "code", { get() { throw new Error("getter"); } });`,
      check: (cause: unknown) => {
        expect(() => (cause as { code: unknown }).code).toThrow("getter");
      },
    },
    {
      name: "a revoked Proxy",
      source: `const p = Proxy.revocable({}, {});
p.revoke();
throw p.proxy;`,
      check: (cause: unknown) => {
        expect(() => "code" in (cause as object)).toThrow(TypeError);
      },
    },
  ])(
    "$name thrown at load fails as TEMPLATE_LOAD_FAILED with the thrown value as cause",
    async ({ name, source, check }) => {
      const file = `throws-hostile-${name.replaceAll(" ", "-")}`;
      await write(`${file}.js`, `${source}\n`);
      const outcome = await send(file);
      const error = expectAdapterError(
        outcome,
        "ERR_REACT_ADAPTER_TEMPLATE_LOAD_FAILED"
      );
      expect(error.template).toBe(file);
      expect(error.path).toBe(path.join(dir, `${file}.js`));
      expect(error.message).toContain("a value that cannot be described");
      expect(error.message).not.toContain(dir);
      expect(Object.hasOwn(error, "cause")).toBe(true);
      check(error.cause);
      expect(outcome.html).toBeUndefined();
    }
  );

  test("an error whose message is a symbol fails as TEMPLATE_LOAD_FAILED and shows the symbol", async () => {
    await write(
      "throws-symbol-message.js",
      `const failure = new Error("x");
Object.defineProperty(failure, "message", { value: Symbol("s") });
throw failure;
`
    );
    const error = expectAdapterError(
      await send("throws-symbol-message"),
      "ERR_REACT_ADAPTER_TEMPLATE_LOAD_FAILED"
    );
    expect(error.message).toContain("failed to load: Symbol(s).");
    expect(error.cause).toBeInstanceOf(Error);
  });

  // The one place a message can carry an absolute path: the text of a plain Error thrown by the template or its
  // dependencies is quoted as given, so a path inside that text is quoted too. A coded error and a SyntaxError
  // that names a path (a malformed .json dependency) never reach it; see the tests below.
  test("an uncoded Error whose text carries an absolute path is quoted, an exception to the no-path rule", async () => {
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

describe("template-loader: a SyntaxError that names a path", () => {
  // A separator-rooted path, a drive path, a UNC path or a file: URL anywhere in the text.
  const ABSOLUTE_PATH =
    /(?:^|[\s"'(=])(?:[A-Za-z]:[\\/]|\\\\|\/(?=[^\s"'/]))|file:\/\//;

  test("a malformed .json dependency fails as TEMPLATE_LOAD_FAILED with no path in the message", async () => {
    await write("broken-data.json", "{ not json");
    await write(
      "needs-broken-json.js",
      `const data = require("./broken-data.json");\nmodule.exports = function Template() { return data; };\n`
    );
    const outcome = await send("needs-broken-json");
    const error = expectAdapterError(
      outcome,
      "ERR_REACT_ADAPTER_TEMPLATE_LOAD_FAILED"
    );
    expect(error.message).toContain("a SyntaxError");
    expect(error.message).toContain("the underlying error is in cause");
    expect(error.message).not.toContain(dir);
    expect(error.message).not.toContain("broken-data.json");
    expect(error.message).not.toMatch(ABSOLUTE_PATH);
    expect(error.cause).toBeInstanceOf(SyntaxError);
    if (error.cause instanceof Error) {
      expect(error.cause.message).toContain("broken-data.json");
    }
    expect(outcome.html).toBeUndefined();
  });

  test("a SyntaxError the template throws with a path in its text shows only its name", async () => {
    await write(
      "throws-syntax-path.js",
      `throw new SyntaxError("bad syntax in " + __filename);\n`
    );
    const error = expectAdapterError(
      await send("throws-syntax-path"),
      "ERR_REACT_ADAPTER_TEMPLATE_LOAD_FAILED"
    );
    expect(error.message).toContain("a SyntaxError");
    expect(error.message).not.toContain("bad syntax in");
    expect(error.message).not.toMatch(ABSOLUTE_PATH);
    expect(error.cause).toBeInstanceOf(SyntaxError);
  });

  test("a SyntaxError from another realm that names a path shows only its name and stays on cause", async () => {
    // A vm context stands in for a Jest sandbox: the value is not an instanceof this realm's Error.
    await write(
      "throws-syntax-path-other-realm.js",
      `throw require("node:vm").runInNewContext(\`new SyntaxError("bad syntax in " + \${JSON.stringify(__filename)})\`);\n`
    );
    const outcome = await send("throws-syntax-path-other-realm");
    const error = expectAdapterError(
      outcome,
      "ERR_REACT_ADAPTER_TEMPLATE_LOAD_FAILED"
    );
    expect(error.message).toContain("a SyntaxError");
    expect(error.message).toContain("the underlying error is in cause");
    expect(error.message).not.toContain("bad syntax in");
    expect(error.message).not.toContain(dir);
    expect(error.message).not.toMatch(ABSOLUTE_PATH);
    expect(error.cause).not.toBeInstanceOf(Error);
    expect(error.cause).toMatchObject({ name: "SyntaxError" });
    if (typeof error.cause === "object" && error.cause !== null) {
      expect(String(Reflect.get(error.cause, "message"))).toContain(
        "bad syntax in"
      );
    }
    expect(outcome.html).toBeUndefined();
  });

  test("a SyntaxError without a path in its text is still quoted", async () => {
    await write(
      "throws-syntax-plain.js",
      `throw new SyntaxError("unexpected token in the template data");\n`
    );
    const error = expectAdapterError(
      await send("throws-syntax-plain"),
      "ERR_REACT_ADAPTER_TEMPLATE_LOAD_FAILED"
    );
    expect(error.message).toContain("unexpected token in the template data");
    expect(error.message).not.toContain("the underlying error is in cause");
  });
});

describe("template-loader: a default export that cannot be inspected", () => {
  // The default export is the template's: a Proxy whose traps throw must still end as INVALID_EXPORT.
  test.each([
    {
      name: "ownKeys",
      // The loader lists the keys once for exportNames, so only the second listing throws.
      traps: `(() => { let calls = 0; return { ownKeys(target) { calls += 1; if (calls > 1) { throw new Error("trap"); } return Reflect.ownKeys(target); } }; })()`,
    },
    {
      name: "get",
      traps: `{ get(target, key) { if (key === "$$typeof") { throw new Error("trap"); } return undefined; } }`,
    },
  ])(
    "a Proxy default export whose $name trap throws fails as INVALID_EXPORT",
    async ({ name, traps }) => {
      const file = `proxy-export-${name}`;
      await write(`${file}.js`, `module.exports = new Proxy({}, ${traps});\n`);
      const error = expectAdapterError(
        await send(file),
        "ERR_REACT_ADAPTER_INVALID_EXPORT"
      );
      expect(error.template).toBe(file);
      expect(error.path).toBe(path.join(dir, `${file}.js`));
      expect(error.message).toContain(
        "found a value that cannot be described."
      );
      expect(error.cause).toBeUndefined();
    }
  );
});

describe("template-loader: render failures", () => {
  test("a component that throws while rendering fails once as RENDER_FAILED without leaking the context", async () => {
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

  test("a component that throws undefined fails as RENDER_FAILED and keeps an undefined cause", async () => {
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
  test("TEMPLATE_NOT_FOUND has no cause", async () => {
    const error = expectAdapterError(
      await send("no-such-template"),
      "ERR_REACT_ADAPTER_TEMPLATE_NOT_FOUND"
    );
    expect(error.cause).toBeUndefined();
  });

  test("INVALID_EXPORT has no cause", async () => {
    await write("invalid-for-cause.js", "module.exports = 7;\n");
    const error = expectAdapterError(
      await send("invalid-for-cause"),
      "ERR_REACT_ADAPTER_INVALID_EXPORT"
    );
    expect(error.cause).toBeUndefined();
  });
});
