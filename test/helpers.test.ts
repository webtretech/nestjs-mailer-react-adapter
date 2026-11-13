import fs from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import type { ReactAdapter } from "../src";
import {
  compileOnce,
  isCiEnvironment,
  makeLink,
  makeTempRoot,
} from "./helpers";

let dir: string;

beforeAll(async () => {
  dir = await makeTempRoot("react-adapter-helpers-");
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function write(file: string, source: string): Promise<string> {
  const full = path.join(dir, file);
  await fs.writeFile(full, source);
  return full;
}

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
