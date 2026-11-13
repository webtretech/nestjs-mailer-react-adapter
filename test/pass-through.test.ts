import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { MailerOptions } from "@nestjs-modules/mailer";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { ReactAdapter } from "../src";
import { compileOnce, expectAdapterError, makeTempRoot } from "./helpers";
import type { Outcome } from "./helpers";

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures"
);

const DOCTYPE_START = "<!DOCTYPE html PUBLIC";

const WITH_DIR: MailerOptions = { template: { dir: FIXTURES } };
const EMPTY_OPTIONS: MailerOptions = {};

type Data = Record<string, unknown>;

function send(
  data: unknown,
  options: MailerOptions = WITH_DIR,
  adapter: ReactAdapter = new ReactAdapter()
): Promise<Outcome> {
  return compileOnce(adapter, { data }, options);
}

function expectSuccess(outcome: Outcome): void {
  expect(outcome.calls).toBe(1);
  expect(outcome.threw).toBeUndefined();
  expect(outcome.early).toBe(false);
  expect(outcome.args).toEqual([]);
}

// Every key keeps its value and its reference, and no key was added or removed.
function expectUntouched(data: Data, before: [string, unknown][]): void {
  expect(Object.keys(data)).toEqual(before.map(([key]) => key));
  for (const [key, value] of before) {
    expect(data[key]).toBe(value);
  }
}

function entriesOf(data: Data): [string, unknown][] {
  return Object.entries(data);
}

let scratch: string;

beforeAll(async () => {
  scratch = await makeTempRoot("react-adapter-mail-");
  // Counts how often the component function runs, on globalThis so the test can read it back.
  await fs.writeFile(
    path.join(scratch, "counted.js"),
    [
      '"use strict";',
      "module.exports = function Counted() {",
      "  globalThis.__reactAdapterRenders = (globalThis.__reactAdapterRenders ?? 0) + 1;",
      "  return null;",
      "};",
      "",
    ].join("\n")
  );
});

afterAll(async () => {
  await fs.rm(scratch, { recursive: true, force: true });
  Reflect.deleteProperty(globalThis, "__reactAdapterRenders");
});

describe("pass-through of mail that already has a body", () => {
  const bodies: [string, () => Data][] = [
    ["truthy html", () => ({ html: "<p>x</p>", subject: "s" })],
    [
      "a truthy raw string",
      () => ({ raw: "From: a\r\n\r\nbody", subject: "s" }),
    ],
    ["a truthy raw Buffer", () => ({ raw: Buffer.from("raw"), subject: "s" })],
    ["a Buffer html", () => ({ html: Buffer.from("<p>x</p>"), subject: "s" })],
    ["text 'x'", () => ({ text: "x", subject: "s" })],
    ["an empty text", () => ({ text: "", subject: "s" })],
    ["a null text", () => ({ text: null, subject: "s" })],
  ];

  test.each(bodies)(
    "no template and %s passes through with every key untouched",
    async (_, build) => {
      const data = build();
      const before = entriesOf(data);
      const outcome = await send(data);
      expectSuccess(outcome);
      expectUntouched(data, before);
    }
  );

  test("pass-through with mailer options {} succeeds without TEMPLATE_DIR_MISSING", async () => {
    const data: Data = { html: "<p>x</p>" };
    const before = entriesOf(data);
    const outcome = await send(data, EMPTY_OPTIONS);
    expectSuccess(outcome);
    expectUntouched(data, before);
  });

  test("a template with truthy html passes through untouched", async () => {
    const data: Data = {
      template: "tsc-cjs",
      context: { body: "Body" },
      html: "<p>mine</p>",
    };
    const before = entriesOf(data);
    const outcome = await send(data);
    expectSuccess(outcome);
    expectUntouched(data, before);
  });

  test("template with truthy raw passes through untouched", async () => {
    const raws = ["From: a\r\n\r\nbody", Buffer.from("From: a\r\n\r\nbody")];
    for (const raw of raws) {
      const data: Data = { template: "does-not-exist", raw, subject: "s" };
      const before = entriesOf(data);
      const outcome = await send(data, EMPTY_OPTIONS);
      expectSuccess(outcome);
      expect("html" in data).toBe(false);
      expect("text" in data).toBe(false);
      expectUntouched(data, before);
    }
  });

  test("a template with text and no html renders html and leaves text untouched", async () => {
    const text = Buffer.from("mine");
    const data: Data = {
      template: "tsc-cjs",
      context: { body: "Body" },
      text,
    };
    const outcome = await send(
      data,
      WITH_DIR,
      new ReactAdapter({ text: true })
    );
    expectSuccess(outcome);
    expect(String(data["html"]).startsWith(DOCTYPE_START)).toBe(true);
    expect(data["text"]).toBe(text);
  });

  test("an empty-string template with text passes through and is never resolved to a .js file", async () => {
    const data: Data = { template: "", text: "t" };
    const before = entriesOf(data);
    const outcome = await send(data, EMPTY_OPTIONS);
    expectSuccess(outcome);
    expectUntouched(data, before);
  });

  test("pass-through is decided before the context is checked", async () => {
    const data: Data = { html: "<p>x</p>", context: "not-an-object" };
    const before = entriesOf(data);
    const outcome = await send(data);
    expectSuccess(outcome);
    expectUntouched(data, before);
  });
});

describe("mail with no body fails with NO_BODY", () => {
  const bodiless: [string, Data][] = [
    ["no keys", {}],
    ["an empty html", { html: "" }],
    ["an empty template", { template: "" }],
    ["an undefined template", { template: undefined, context: {} }],
    ["a null template", { template: null }],
  ];

  test.each(bodiless)(
    "%s fails once with ERR_REACT_ADAPTER_NO_BODY and no template, path or cause",
    async (_, data) => {
      const outcome = await send(data);
      const error = expectAdapterError(outcome, "ERR_REACT_ADAPTER_NO_BODY");
      expect(error.template).toBeUndefined();
      expect(error.path).toBeUndefined();
      expect(error.cause).toBeUndefined();
    }
  );

  test("the NO_BODY message names what is missing and no values", async () => {
    const outcome = await send({ html: "", subject: "secret-subject" });
    const error = expectAdapterError(outcome, "ERR_REACT_ADAPTER_NO_BODY");
    expect(error.message).toContain("no template");
    expect(error.message).not.toContain("secret-subject");
  });
});

describe("malformed mail fails with INVALID_MAIL", () => {
  const shapes: [string, unknown][] = [
    ["null", null],
    ["a string", "x"],
    ["an object without data", {}],
    ["a null data", { data: null }],
    ["a string data", { data: "x" }],
    ["an array data", { data: [] }],
  ];

  test.each(shapes)(
    "mail %s fails once with ERR_REACT_ADAPTER_INVALID_MAIL and no template or cause",
    async (_, mail) => {
      const outcome = await compileOnce(new ReactAdapter(), mail, WITH_DIR);
      const error = expectAdapterError(
        outcome,
        "ERR_REACT_ADAPTER_INVALID_MAIL"
      );
      expect(error.template).toBeUndefined();
      expect(error.path).toBeUndefined();
      expect(error.cause).toBeUndefined();
    }
  );

  test("a non-string template names the type and is reported without a template name", async () => {
    const outcome = await send({ template: 42 });
    const error = expectAdapterError(outcome, "ERR_REACT_ADAPTER_INVALID_MAIL");
    expect(error.message).toContain("number");
    expect(error.message).not.toContain("42");
    expect(error.template).toBeUndefined();
    expect(error.cause).toBeUndefined();
  });

  test.each([
    ["a string", "s3cr3t", "string"],
    ["an array", [1], "array"],
    ["a number", 5, "number"],
  ])(
    "a context that is %s names its type and never its value",
    async (_, context, typeName) => {
      const outcome = await send({ template: "tsc-cjs", context });
      const error = expectAdapterError(
        outcome,
        "ERR_REACT_ADAPTER_INVALID_MAIL"
      );
      expect(error.message).toContain(typeName);
      expect(error.message).not.toContain("s3cr3t");
      expect(error.cause).toBeUndefined();
    }
  );

  test.each([
    ["undefined", undefined],
    ["null", null],
  ])("a %s context renders as an empty context", async (_, context) => {
    const data: Data = { template: "tsc-cjs", context };
    const outcome = await send(data);
    expectSuccess(outcome);
    expect(String(data["html"]).startsWith(DOCTYPE_START)).toBe(true);
  });

  test("frozen mail.data fails once with INVALID_MAIL and the TypeError as cause", async () => {
    const data = Object.freeze({
      template: "tsc-cjs",
      context: { body: "Body" },
      html: undefined,
    });
    const outcome = await send(data);
    const error = expectAdapterError(outcome, "ERR_REACT_ADAPTER_INVALID_MAIL");
    expect(error.cause).toBeInstanceOf(TypeError);
    expect(error.template).toBe("tsc-cjs");
    expect(error.path).toBe(path.join(FIXTURES, "tsc-cjs.js"));
  });
});

describe("failure order and causes", () => {
  test("a relative missing template with mailer options {} reports TEMPLATE_DIR_MISSING", async () => {
    const outcome = await send({ template: "missing" }, EMPTY_OPTIONS);
    const error = expectAdapterError(
      outcome,
      "ERR_REACT_ADAPTER_TEMPLATE_DIR_MISSING"
    );
    expect(error.cause).toBeUndefined();
  });

  test("the template type is checked before the directory", async () => {
    const outcome = await send({ template: 42 }, EMPTY_OPTIONS);
    expectAdapterError(outcome, "ERR_REACT_ADAPTER_INVALID_MAIL");
  });

  test("a missing template has no cause", async () => {
    const outcome = await send({ template: "does-not-exist" });
    const error = expectAdapterError(
      outcome,
      "ERR_REACT_ADAPTER_TEMPLATE_NOT_FOUND"
    );
    expect(error.cause).toBeUndefined();
    expect(error.template).toBe("does-not-exist");
  });

  test("an invalid export has no cause", async () => {
    const outcome = await send({ template: "exports-default-no-esmodule" });
    const error = expectAdapterError(
      outcome,
      "ERR_REACT_ADAPTER_INVALID_EXPORT"
    );
    expect(error.cause).toBeUndefined();
  });
});

describe("what compile() writes", () => {
  test("a send that renders changes only html and text, and keeps every other reference", async () => {
    const context = { body: "Body" };
    const attachments = [{ filename: "a.txt" }];
    const data: Data = {
      template: "tsc-cjs",
      context,
      subject: "subject",
      attachments,
      to: "someone@example.com",
    };
    const before = entriesOf(data);
    const outcome = await send(
      data,
      WITH_DIR,
      new ReactAdapter({ text: true })
    );
    expectSuccess(outcome);
    expect(Object.keys(data).sort()).toEqual(
      [...before.map(([key]) => key), "html", "text"].sort()
    );
    for (const [key, value] of before) {
      expect(data[key]).toBe(value);
    }
    expect(data["context"]).toBe(context);
    expect(data["attachments"]).toBe(attachments);
  });

  test("the component runs once per send, even with text and pretty", async () => {
    Reflect.set(globalThis, "__reactAdapterRenders", 0);
    const data: Data = { template: "counted", context: {} };
    const outcome = await send(
      data,
      { template: { dir: scratch } },
      new ReactAdapter({ text: true, pretty: true })
    );
    expectSuccess(outcome);
    expect(Reflect.get(globalThis, "__reactAdapterRenders")).toBe(1);
  });
});
