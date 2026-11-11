import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { render, toPlainText, unstableToPlainText } from "@react-email/render";
import type * as RenderModule from "@react-email/render";
import { createElement } from "react";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";

import { ReactAdapter, ReactAdapterError } from "../src";
import type { ReactAdapterOptions } from "../src";
import { compileOnce, expectAdapterError } from "./helpers";
import type { Outcome } from "./helpers";

// Pass-through spies: the real functions run, the calls are recorded.
vi.mock("@react-email/render", async (importOriginal) => {
  const actual = await importOriginal<typeof RenderModule>();
  return {
    ...actual,
    render: vi.fn(actual.render),
    toPlainText: vi.fn(actual.toPlainText),
    unstableToPlainText: vi.fn(actual.unstableToPlainText),
  };
});

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures"
);

const DOCTYPE =
  '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">';

const PRETTY = `${DOCTYPE}\n<!--$-->\n<div>\n  <h1>tsc-cjs</h1>\n  <p>Body</p>\n</div>\n<!--/$-->\n`;

// The same tree as test/fixtures/tsc-cjs.js, used to compute the expected output with render itself.
function Welcome({ body }: { body: string }) {
  return createElement(
    "div",
    null,
    createElement("h1", null, "tsc-cjs"),
    createElement("p", null, body)
  );
}

function makeMail(data: Record<string, unknown> = {}): {
  data: Record<string, unknown>;
} {
  return { data: { template: "tsc-cjs", context: { body: "Body" }, ...data } };
}

async function send(
  adapter: ReactAdapter,
  data: Record<string, unknown> = {},
  dir: string = FIXTURES
) {
  const mail = makeMail(data);
  const outcome = await compileOnce(adapter, mail, { template: { dir } });
  return { outcome, data: mail.data };
}

function expectSuccess(outcome: Outcome): void {
  expect(outcome.calls).toBe(1);
  expect(outcome.threw).toBeUndefined();
  expect(outcome.early).toBe(false);
  expect(outcome.args).toEqual([]);
}

let scratch: string;

beforeAll(async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), "react-adapter-text-"));
  await fs.writeFile(
    path.join(scratch, "nothing.js"),
    "module.exports = function Nothing() { return null; };\n"
  );
});

afterAll(async () => {
  await fs.rm(scratch, { recursive: true, force: true });
});

beforeEach(() => {
  vi.mocked(render).mockClear();
  vi.mocked(toPlainText).mockClear();
  vi.mocked(unstableToPlainText).mockClear();
  // plainText is a deprecated key; keep the warning out of the test output.
  vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);
});

describe("text part from one render", () => {
  const matrix: ReactAdapterOptions[] = [
    {},
    { text: true },
    { plainText: true },
    { pretty: true, text: true },
    { text: true, unstableTextConversion: true },
    { text: true, htmlToTextOptions: { wordwrap: 20 } },
  ];

  test.each(matrix)(
    "html starts with the XHTML doctype for options %j",
    async (options) => {
      const { outcome, data } = await send(new ReactAdapter(options));
      expectSuccess(outcome);
      expect(typeof data["html"]).toBe("string");
      expect(String(data["html"]).startsWith(DOCTYPE)).toBe(true);
    }
  );

  test("no text key is added when the text option is off", async () => {
    const { outcome, data } = await send(new ReactAdapter());
    expectSuccess(outcome);
    expect("text" in data).toBe(false);
  });

  test("text: true fills text with what render produces for plainText", async () => {
    const expected = await render(createElement(Welcome, { body: "Body" }), {
      plainText: true,
    });
    const { outcome, data } = await send(new ReactAdapter({ text: true }));
    expectSuccess(outcome);
    expect(data["text"]).toBe(expected);
    expect(String(data["html"]).startsWith(DOCTYPE)).toBe(true);
    expect(String(data["html"])).not.toBe(expected);
  });

  test("htmlToTextOptions reach the converter and match render's own output", async () => {
    const htmlToTextOptions = { wordwrap: 4 };
    const expected = await render(createElement(Welcome, { body: "Body" }), {
      plainText: true,
      htmlToTextOptions,
    });
    const { outcome, data } = await send(
      new ReactAdapter({ text: true, htmlToTextOptions })
    );
    expectSuccess(outcome);
    expect(data["text"]).toBe(expected);
    expect(vi.mocked(toPlainText)).toHaveBeenCalledTimes(1);
  });

  test("unstableTextConversion uses the in-house formatter and wins over htmlToTextOptions", async () => {
    const expected = await render(createElement(Welcome, { body: "Body" }), {
      plainText: true,
      unstableTextConversion: true,
    });
    vi.mocked(toPlainText).mockClear();
    vi.mocked(unstableToPlainText).mockClear();
    const { outcome, data } = await send(
      new ReactAdapter({
        text: true,
        unstableTextConversion: true,
        htmlToTextOptions: { wordwrap: 4 },
      })
    );
    expectSuccess(outcome);
    expect(data["text"]).toBe(expected);
    expect(vi.mocked(unstableToPlainText)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toPlainText)).not.toHaveBeenCalled();
  });

  test("htmlToTextOptions {} gives the same text as no options", async () => {
    const plain = await send(new ReactAdapter({ text: true }));
    const empty = await send(
      new ReactAdapter({ text: true, htmlToTextOptions: {} })
    );
    expectSuccess(plain.outcome);
    expectSuccess(empty.outcome);
    expect(empty.data["text"]).toBe(plain.data["text"]);
    expect(typeof plain.data["text"]).toBe("string");
  });

  test("with pretty and text, html is the pretty characterization and text is built from the raw html", async () => {
    const withoutPretty = await send(new ReactAdapter({ text: true }));
    const withPretty = await send(
      new ReactAdapter({ pretty: true, text: true })
    );
    expectSuccess(withPretty.outcome);
    expect(withPretty.data["html"]).toBe(PRETTY);
    expect(withPretty.data["text"]).toBe(withoutPretty.data["text"]);
  });

  test("pretty html equals render(node, { pretty: true })", async () => {
    const expected = await render(createElement(Welcome, { body: "Body" }), {
      pretty: true,
    });
    const { outcome, data } = await send(new ReactAdapter({ pretty: true }));
    expectSuccess(outcome);
    expect(data["html"]).toBe(expected);
  });

  test("render runs once per send and never receives the adapter's own keys", async () => {
    const options = {
      pretty: true,
      text: true,
      plainText: true,
      htmlToTextOptions: { wordwrap: 20 },
      unstableTextConversion: false,
      futureOption: 1,
    };
    const adapter = new ReactAdapter(options);
    vi.mocked(render).mockClear();
    const { outcome } = await send(adapter);
    expectSuccess(outcome);
    expect(vi.mocked(render)).toHaveBeenCalledTimes(1);
    const [, renderOptions] = vi.mocked(render).mock.calls[0] ?? [];
    for (const key of [
      "pretty",
      "text",
      "plainText",
      "htmlToTextOptions",
      "unstableTextConversion",
    ]) {
      expect(renderOptions).not.toHaveProperty(key);
    }
    expect(renderOptions).toEqual({ futureOption: 1 });
  });

  test("a mutation of the options object after construction changes nothing", async () => {
    const options: ReactAdapterOptions = { text: true };
    const adapter = new ReactAdapter(options);
    options.text = false;
    const { outcome, data } = await send(adapter);
    expectSuccess(outcome);
    expect(typeof data["text"]).toBe("string");
  });

  const buffer = Buffer.from("provided");
  test.each([
    ["an empty string", ""],
    ["null", null],
    ["a string", "provided"],
    ["a Buffer", buffer],
  ])("a caller text of %s is kept and no conversion runs", async (_, given) => {
    vi.mocked(toPlainText).mockClear();
    vi.mocked(unstableToPlainText).mockClear();
    const { outcome, data } = await send(new ReactAdapter({ text: true }), {
      text: given,
    });
    expectSuccess(outcome);
    expect(data["text"]).toBe(given);
    expect(vi.mocked(toPlainText)).not.toHaveBeenCalled();
    expect(vi.mocked(unstableToPlainText)).not.toHaveBeenCalled();
    expect(String(data["html"]).startsWith(DOCTYPE)).toBe(true);
  });

  test("a component that renders null still yields a doctype string", async () => {
    const mail = { data: { template: "nothing", context: {} } };
    const outcome = await compileOnce(new ReactAdapter({ text: true }), mail, {
      template: { dir: scratch },
    });
    expectSuccess(outcome);
    const html: unknown = Reflect.get(mail.data, "html");
    expect(typeof html).toBe("string");
    expect(String(html).startsWith(DOCTYPE)).toBe(true);
    expect(typeof Reflect.get(mail.data, "text")).toBe("string");
  });

  test("non-ASCII context round-trips exactly as toPlainText produces it", async () => {
    const body = "Grüße 👋 你好";
    const expected = await render(createElement(Welcome, { body }), {
      plainText: true,
    });
    const { outcome, data } = await send(new ReactAdapter({ text: true }), {
      context: { body },
    });
    expectSuccess(outcome);
    expect(data["text"]).toBe(expected);
    expect(String(data["text"])).toContain(body);
  });

  test("a converter failure fails the send once as TEXT_FAILED and writes neither html nor text", async () => {
    const adapter = new ReactAdapter({
      text: true,
      htmlToTextOptions: { selectors: [{ selector: "p", format: "nope" }] },
    });
    const { outcome, data } = await send(adapter);
    const error = expectAdapterError(outcome, "ERR_REACT_ADAPTER_TEXT_FAILED");
    expect(error).toBeInstanceOf(ReactAdapterError);
    expect(error.cause).toBeInstanceOf(Error);
    expect(error.template).toBe("tsc-cjs");
    expect(error.path).toBe(path.join(FIXTURES, "tsc-cjs.js"));
    expect(error.message).toContain("tsc-cjs");
    expect("html" in data).toBe(false);
    expect("text" in data).toBe(false);
  });

  test("the 0.2.x option shapes still type-check and construct", () => {
    const typeChecks = [
      new ReactAdapter({}),
      new ReactAdapter({ pretty: true }),
      new ReactAdapter({ plainText: true }),
      new ReactAdapter({
        plainText: true,
        htmlToTextOptions: { wordwrap: 80 },
      }),
      new ReactAdapter({ pretty: false, plainText: false }),
    ];
    expect(typeChecks).toHaveLength(5);
    for (const adapter of typeChecks) {
      expect(adapter).toBeInstanceOf(ReactAdapter);
    }
  });
});
