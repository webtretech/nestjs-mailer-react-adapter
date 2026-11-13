import path from "node:path";
import { fileURLToPath } from "node:url";

import type { MailerOptions } from "@nestjs-modules/mailer";
import { describe, expect, test } from "vitest";

import { REACT_ADAPTER_ERROR_CODES } from "../src";
import {
  classifyTemplateName,
  isUncNameAllowed,
  messageTemplateName,
  quotedTemplateName,
} from "../src/template.confine";
import type { NameVerdict } from "../src/template.confine";
import { compileTemplate, expectAdapterError } from "./helpers";

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures"
);

const options = (): MailerOptions => ({ template: { dir: FIXTURES } });

const NUL = "nul-byte";
const SCHEME = "url-scheme";
const DEVICE = "windows-device";
const DRIVE_UNC = "windows-drive-or-unc";
const OK = "ok";

// Each row: the input, the verdict for the posix flavor, the verdict for the win32 flavor.
// Every input is a TypeScript string literal, so "C:\\x" is C, colon, backslash, x.
const NAME_ROWS: ReadonlyArray<[string, NameVerdict, NameVerdict]> = [
  ["a\0b", NUL, NUL],
  ["\0", NUL, NUL],
  ["file:x\0", NUL, NUL],
  ["file:///etc/passwd", SCHEME, SCHEME],
  ["FILE:x", SCHEME, SCHEME],
  ["http://a/b", SCHEME, SCHEME],
  ["data:text/javascript,1", SCHEME, SCHEME],
  ["node:os", SCHEME, SCHEME],
  ["ab:c", SCHEME, SCHEME],
  ["a+b.c-d:e", SCHEME, SCHEME],
  ["welcome.js:stream", SCHEME, SCHEME],
  ["release-2026:q1", SCHEME, SCHEME],
  ["emails/2026:q1/welcome", OK, OK],
  ["1x:y", OK, OK],
  ["x:y", DRIVE_UNC, OK],
  ["C:\\x", DRIVE_UNC, OK],
  ["C:/x", DRIVE_UNC, OK],
  ["C:x", DRIVE_UNC, OK],
  ["c:x", DRIVE_UNC, OK],
  ["C:", DRIVE_UNC, OK],
  ["\\\\server\\share\\x", DRIVE_UNC, OK],
  ["//server/share/x", DRIVE_UNC, OK],
  ["//x", DRIVE_UNC, OK],
  ["\\\\", DRIVE_UNC, OK],
  ["//", DRIVE_UNC, OK],
  ["\\\\?\\C:\\x", DEVICE, DEVICE],
  ["\\\\.\\pipe\\x", DEVICE, DEVICE],
  ["//?/x", DEVICE, DEVICE],
  ["//./x", DEVICE, DEVICE],
  ["\\\\?\\UNC\\srv\\sh\\x", DEVICE, DEVICE],
  ["welcome", OK, OK],
  ["nested/deep/welcome", OK, OK],
  ["a\\b", OK, OK],
  ["%2e%2e%2fout", OK, OK],
  ["../x", OK, OK],
  ["/abs/x", OK, OK],
];

describe("classifyTemplateName with the posix flavor", () => {
  test.each(NAME_ROWS.map(([name, posix]) => [name, posix] as const))(
    "%j is %s",
    (name, expected) => {
      expect(classifyTemplateName(name, path.posix)).toBe(expected);
    }
  );
});

describe("classifyTemplateName with the win32 flavor", () => {
  test.each(NAME_ROWS.map(([name, , win32]) => [name, win32] as const))(
    "%j is %s",
    (name, expected) => {
      expect(classifyTemplateName(name, path.win32)).toBe(expected);
    }
  );
});

const SRV_ROOT = "\\\\srv\\sh\\r";

// Each row: name, configured roots, allowOutside, flavor, expected. win32 and no opt-out unless stated.
const UNC_ROWS: ReadonlyArray<
  [string, string[], boolean, typeof path, boolean]
> = [
  ["\\\\srv\\sh\\x", [SRV_ROOT], false, path.win32, true],
  ["\\\\SRV\\Sh\\x", [SRV_ROOT], false, path.win32, true],
  ["//srv/sh/x", [SRV_ROOT], false, path.win32, true],
  ["\\\\srv\\sh\\x", ["//SRV/SH/r"], false, path.win32, true],
  ["\\\\srv\\sh\\x", ["\\\\srv\\sh\\"], false, path.win32, true],
  ["\\\\srv\\sh\\x", ["\\\\srv\\sh"], false, path.win32, true],
  ["\\\\srv\\sh\\x", ["//srv/sh/"], false, path.win32, true],
  ["\\\\srv\\sh\\x", ["//srv/sh"], false, path.win32, true],
  ["\\\\srv\\shadow\\x", ["\\\\srv\\sh"], false, path.win32, false],
  ["\\\\srv\\sh\\..\\..\\other\\x", [SRV_ROOT], false, path.win32, true],
  ["\\\\srv\\other\\x", [SRV_ROOT], false, path.win32, false],
  ["\\\\evil\\sh\\x", [SRV_ROOT], false, path.win32, false],
  ["\\\\srv\\sh\\x", ["C:\\r"], false, path.win32, false],
  ["\\\\srv\\sh\\x", [], false, path.win32, false],
  ["\\\\srv\\sh\\x", ["C:\\r", SRV_ROOT], false, path.win32, true],
  ["\\\\srv", [SRV_ROOT], false, path.win32, false],
  ["\\\\srv\\\\sh\\x", [SRV_ROOT], false, path.win32, false],
  ["\\\\srv\\sh\\x", ["C:\\r"], true, path.win32, true],
  ["welcome", ["C:\\r"], false, path.win32, true],
  ["C:\\r\\x", ["C:\\r"], false, path.win32, true],
  ["//srv/sh/x", ["//srv/sh/r"], false, path.posix, false],
];

describe("isUncNameAllowed (the Windows UNC share guard)", () => {
  test.each(UNC_ROWS)(
    "%j with roots %j, allowOutside %j, flavor %#: %s",
    (name, roots, allowOutside, flavor, expected) => {
      expect(isUncNameAllowed(name, roots, allowOutside, flavor)).toBe(
        expected
      );
    }
  );
});

describe("messageTemplateName", () => {
  test.each<[string, string]>([
    ["/app/dist/emails/welcome.js", "welcome.js"],
    ["C:\\emails\\welcome", "welcome"],
    ["C:/emails/welcome", "welcome"],
    ["\\\\srv\\sh\\emails\\welcome", "welcome"],
    ["//srv/sh/x", "x"],
    ["\\\\?\\C:\\x", "x"],
    ["\\x", "x"],
    ["/a/b/", "b"],
    ["/", ""],
    ["file:///etc/passwd", "passwd"],
    ["file:x", "file:x"],
    ["welcome", "welcome"],
    ["emails/welcome", "emails/welcome"],
    ["../secrets", "../secrets"],
    ["C:x", "C:x"],
    ["a\\b", "a\\b"],
    ["/etc/passwd\0", "passwd\0"],
  ])("%j shows as %j", (name, expected) => {
    expect(messageTemplateName(name)).toBe(expected);
  });
});

describe("invalid template names through compile()", () => {
  test("a NUL byte is INVALID_TEMPLATE_NAME with no path, searched or roots", async () => {
    const input = "tsc-cjs\0";
    const error = expectAdapterError(
      await compileTemplate(input, options()),
      REACT_ADAPTER_ERROR_CODES.INVALID_TEMPLATE_NAME
    );
    expect(error.template).toBe(input);
    expect(error.path).toBeUndefined();
    expect(error.searched).toBeUndefined();
    expect(error.roots).toBeUndefined();
    expect(error.message).toContain("\\u0000");
    expect(error.message).not.toContain(FIXTURES);
  });

  test("a file: name is INVALID_TEMPLATE_NAME", async () => {
    expectAdapterError(
      await compileTemplate("file:tsc-cjs", options()),
      REACT_ADAPTER_ERROR_CODES.INVALID_TEMPLATE_NAME
    );
  });

  test("a node: name is INVALID_TEMPLATE_NAME", async () => {
    expectAdapterError(
      await compileTemplate("node:os", options()),
      REACT_ADAPTER_ERROR_CODES.INVALID_TEMPLATE_NAME
    );
  });

  test("the name rules run before the missing-directory rule", async () => {
    expectAdapterError(
      await compileTemplate("file:x", {}),
      REACT_ADAPTER_ERROR_CODES.INVALID_TEMPLATE_NAME
    );
  });

  test("a verbatim drive form is INVALID_TEMPLATE_NAME on every OS", async () => {
    expectAdapterError(
      await compileTemplate("\\\\?\\C:\\x", options()),
      REACT_ADAPTER_ERROR_CODES.INVALID_TEMPLATE_NAME
    );
  });

  test("a colon inside a path component is an ordinary relative name", async () => {
    const error = expectAdapterError(
      await compileTemplate("emails/2026:q1/welcome", options()),
      REACT_ADAPTER_ERROR_CODES.TEMPLATE_NOT_FOUND
    );
    expect(error.searched).toHaveLength(3);
  });

  test("an absolute name with a NUL byte shows only its last segment", async () => {
    const input = path.join(FIXTURES, "tsc-cjs\0");
    const error = expectAdapterError(
      await compileTemplate(input, options()),
      REACT_ADAPTER_ERROR_CODES.INVALID_TEMPLATE_NAME
    );
    expect(error.template).toBe(input);
    expect(error.message).toContain("tsc-cjs\\u0000");
    expect(error.message).not.toContain(FIXTURES);
  });

  test.skipIf(process.platform === "win32")(
    "drive-letter and UNC names are INVALID_TEMPLATE_NAME off Windows",
    async () => {
      for (const name of ["C:\\x", "//srv/sh/x"]) {
        expectAdapterError(
          await compileTemplate(name, options()),
          REACT_ADAPTER_ERROR_CODES.INVALID_TEMPLATE_NAME
        );
      }
    }
  );
});

// JSON.stringify escapes U+0000 to U+001F, the quote and the backslash, and leaves the rest raw. These are the
// raw characters a terminal or a log viewer still acts on, so quotedTemplateName escapes them as well.
const ESCAPED_AFTER_JSON: Array<{ label: string; code: number }> = [
  { label: "DEL", code: 0x7f },
  { label: "the first C1 control", code: 0x80 },
  { label: "the 8-bit CSI", code: 0x9b },
  { label: "the last C1 control", code: 0x9f },
  { label: "the Arabic letter mark", code: 0x61c },
  { label: "the left-to-right mark", code: 0x200e },
  { label: "the right-to-left mark", code: 0x200f },
  { label: "the line separator", code: 0x2028 },
  { label: "the paragraph separator", code: 0x2029 },
  { label: "the left-to-right embedding", code: 0x202a },
  { label: "the right-to-left override", code: 0x202e },
  { label: "the left-to-right isolate", code: 0x2066 },
  { label: "the pop directional isolate", code: 0x2069 },
  { label: "the byte order mark", code: 0xfeff },
];

// Just outside each escaped range, plus ordinary text in other scripts: shown as given.
const LEFT_RAW = [
  0x7e, 0xa0, 0xa1, 0xe9, 0x65e5, 0x200d, 0x2027, 0x202f, 0x2065, 0x206a,
];

describe("quotedTemplateName", () => {
  test.each(ESCAPED_AFTER_JSON)(
    "$label is shown as a backslash-u escape, valid inside a JSON string",
    ({ code }) => {
      const raw = String.fromCharCode(code);
      const hex = code.toString(16).padStart(4, "0");
      const quoted = quotedTemplateName(`a${raw}b`);
      expect(quoted).toBe(`"a\\u${hex}b"`);
      expect(quoted).not.toContain(raw);
      expect(JSON.parse(quoted)).toBe(`a${raw}b`);
    }
  );

  test.each(
    LEFT_RAW.map((code) => ({
      code,
      hex: code.toString(16).toUpperCase().padStart(4, "0"),
    }))
  )("U+$hex is shown as given", ({ code }) => {
    const name = `a${String.fromCharCode(code)}b`;
    expect(quotedTemplateName(name)).toBe(`"${name}"`);
  });

  test("a name with none of those characters is exactly what JSON.stringify gives", () => {
    for (const name of [
      "welcome",
      "emails/welcome",
      "sub\\welcome",
      "a\nb",
      "a\u001bb",
      'a"q"b',
      "tsc-cjs\0",
      "café 日本語 😀",
      "/app/dist/emails/welcome.js",
    ]) {
      expect(quotedTemplateName(name)).toBe(
        JSON.stringify(messageTemplateName(name))
      );
    }
  });

  test("a relative name with several of them reads as escapes only", () => {
    const name = `x${String.fromCharCode(0x9b)}2J${String.fromCharCode(0x202e)}${String.fromCharCode(0x2066)}${String.fromCharCode(0x2028)}${String.fromCharCode(0x7f)}`;
    expect(quotedTemplateName(name)).toBe(
      '"x\\u009b2J\\u202e\\u2066\\u2028\\u007f"'
    );
  });
});

describe("hostile relative names through compile()", () => {
  test("a C1 control, DEL, a bidi override and a line separator reach the message as escapes, not raw", async () => {
    const name = `a${String.fromCharCode(0x9b)}2J${String.fromCharCode(0x202e)}b${String.fromCharCode(0x2066)}c${String.fromCharCode(0x2028)}d${String.fromCharCode(0x7f)}`;
    const error = expectAdapterError(
      await compileTemplate(name, options()),
      REACT_ADAPTER_ERROR_CODES.TEMPLATE_NOT_FOUND
    );
    expect(error.template).toBe(name);
    expect(error.message).toContain(
      '"a\\u009b2J\\u202eb\\u2066c\\u2028d\\u007f"'
    );
    expect(error.message).not.toMatch(
      /[\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/
    );
    expect(error.message).not.toContain(FIXTURES);
  });
});
