import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { MockInstance } from "vitest";

import type { ReactAdapter as Adapter } from "../src";

import { compileOnce } from "./helpers";
import type { Outcome } from "./helpers";

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures"
);

const DOCTYPE_START = "<!DOCTYPE html PUBLIC";

const WARNING_OPTIONS = {
  type: "DeprecationWarning",
  code: "REACT_ADAPTER_DEP0001",
};

let emitWarning: MockInstance<typeof process.emitWarning>;

// The once-per-process flag lives in the module, so every test loads a fresh copy of it.
async function freshAdapter() {
  const { ReactAdapter } = await import("../src");
  return ReactAdapter;
}

async function send(
  adapter: Adapter
): Promise<{ outcome: Outcome; data: Record<string, unknown> }> {
  const mail: { data: Record<string, unknown> } = {
    data: { template: "tsc-cjs", context: { body: "Body" } },
  };
  const outcome = await compileOnce(adapter, mail, {
    template: { dir: FIXTURES },
  });
  return { outcome, data: mail.data };
}

beforeEach(() => {
  vi.resetModules();
  emitWarning = vi.spyOn(process, "emitWarning").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("plainText as a deprecated alias for text", () => {
  test("two constructions with plainText: true warn once per process", async () => {
    const ReactAdapter = await freshAdapter();
    new ReactAdapter({ plainText: true });
    new ReactAdapter({ plainText: true });
    expect(emitWarning).toHaveBeenCalledTimes(1);
  });

  test("the warning is a DeprecationWarning with code REACT_ADAPTER_DEP0001 naming plainText and text", async () => {
    const ReactAdapter = await freshAdapter();
    new ReactAdapter({ plainText: true });
    expect(emitWarning).toHaveBeenCalledWith(
      expect.stringMatching(/plainText.*\btext\b/s),
      WARNING_OPTIONS
    );
  });

  test("plainText: false warns too, whenever the key holds a boolean", async () => {
    const ReactAdapter = await freshAdapter();
    new ReactAdapter({ plainText: false });
    expect(emitWarning).toHaveBeenCalledTimes(1);
    expect(emitWarning).toHaveBeenCalledWith(
      expect.any(String),
      WARNING_OPTIONS
    );
    new ReactAdapter({ plainText: true });
    expect(emitWarning).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["no argument", undefined],
    ["an empty object", {}],
    ["plainText: undefined", { plainText: undefined }],
    ["text: true", { text: true }],
    ["pretty: true", { pretty: true }],
  ])("%s does not warn", async (_, options) => {
    const ReactAdapter = await freshAdapter();
    new ReactAdapter(options);
    expect(emitWarning).not.toHaveBeenCalled();
  });

  test("plainText: true keeps HTML in html and fills text", async () => {
    const ReactAdapter = await freshAdapter();
    const { outcome, data } = await send(new ReactAdapter({ plainText: true }));
    expect(outcome.calls).toBe(1);
    expect(outcome.args).toEqual([]);
    expect(String(data["html"]).startsWith(DOCTYPE_START)).toBe(true);
    expect(typeof data["text"]).toBe("string");
    expect(String(data["text"])).not.toContain("<");
    expect(String(data["text"])).toContain("Body");
    expect(emitWarning).toHaveBeenCalledTimes(1);
  });

  test("text: false wins over plainText: true: no text, and the warning is still emitted", async () => {
    const ReactAdapter = await freshAdapter();
    const { outcome, data } = await send(
      new ReactAdapter({ text: false, plainText: true })
    );
    expect(outcome.args).toEqual([]);
    expect(String(data["html"]).startsWith(DOCTYPE_START)).toBe(true);
    expect("text" in data).toBe(false);
    expect(emitWarning).toHaveBeenCalledTimes(1);
  });

  test("text: true wins over plainText: false: text is filled, and the warning is emitted", async () => {
    const ReactAdapter = await freshAdapter();
    const { outcome, data } = await send(
      new ReactAdapter({ text: true, plainText: false })
    );
    expect(outcome.args).toEqual([]);
    expect(typeof data["text"]).toBe("string");
    expect(emitWarning).toHaveBeenCalledTimes(1);
  });

  test("plainText: false alone fills no text", async () => {
    const ReactAdapter = await freshAdapter();
    const { data } = await send(new ReactAdapter({ plainText: false }));
    expect("text" in data).toBe(false);
  });
});
