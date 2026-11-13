import { spawn } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

// Expected failures throw this instead of calling process.exit(), which would skip the `finally`
// that removes the scratch directory (same idea as VerifyFailure in verify-types.mjs).
export class CheckFailure extends Error {}

export const repoRoot = path.resolve(import.meta.dirname, "..", "..");

// Upper bounds, so a hung child fails the leg instead of waiting for the CI job limit. An npm
// install here takes up to about a minute and a tsc or consumer run takes seconds, so these are
// far above a normal run and are not tuned to one.
export const NPM_TIMEOUT_MS = 10 * 60 * 1000;
export const RUN_TIMEOUT_MS = 5 * 60 * 1000;

export function startFailure(label, error, timeoutMs) {
  return new CheckFailure(
    error.code === "ETIMEDOUT"
      ? `${label} timed out after ${timeoutMs / 1000} s`
      : `${label} could not start: ${error.message}`
  );
}

// A child killed by a signal has a null status, so name the signal.
export function exitDescription(result) {
  return result.status === null
    ? `was killed by ${result.signal}`
    : `exited ${result.status}`;
}

// Interrupts. The default action of SIGINT and SIGTERM ends Node on the spot, without unwinding the
// `finally` that removes the scratch directory (a full node_modules). A handler alone is not enough
// either: these scripts are straight-line code, so a handler can only run while a child process is
// awaited, and it must make the run stop instead of letting it go on to the next step. So the first
// signal is recorded and passed on to the running children (a Ctrl-C already reached them through
// the terminal's process group, but a signal sent to this process alone has not), spawnAsync then
// fails with CheckFailure once the child is gone, the script's own catch and `finally` run as for any
// other failure, and the exit code is 128 plus the signal number. A second signal exits at once, for
// a user who does not want to wait for the cleanup.
let interrupted;
const runningChildren = new Set();

function interruptExitCode() {
  return 128 + os.constants.signals[interrupted];
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (interrupted !== undefined) {
      process.exit(interruptExitCode());
    }
    interrupted = signal;
    for (const child of runningChildren) child.kill(signal);
  });
}

// An interrupt that arrives while no child is running (during file work, or after the last child)
// still fails the run: the exit code is set here whatever the script decided.
process.on("exit", () => {
  if (interrupted !== undefined) process.exitCode = interruptExitCode();
});

function throwIfInterrupted() {
  if (interrupted !== undefined) {
    throw new CheckFailure(`interrupted by ${interrupted}`);
  }
}

// An argv array with no shell, so nothing a caller passes is ever interpreted by a shell. Resolves
// to { status, signal, error, stdout, stderr } like spawnSync (stdout and stderr are strings when
// piped, else null), and rejects with CheckFailure when the run was interrupted. A child killed by
// a signal has status null and a signal, so it is never taken for a pass. `timeout` ends the child
// with SIGTERM and sets error.code to ETIMEDOUT.
export function spawnAsync(command, args, options = {}) {
  throwIfInterrupted();
  const { timeout, ...spawnOptions } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, ...spawnOptions });
    runningChildren.add(child);
    let stdout = child.stdout === null ? null : "";
    let stderr = child.stderr === null ? null : "";
    child.stdout?.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr?.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));

    let error;
    let settled = false;
    const timer =
      timeout === undefined
        ? undefined
        : setTimeout(() => {
            error = Object.assign(new Error(`spawn ${command} ETIMEDOUT`), {
              code: "ETIMEDOUT",
            });
            child.kill("SIGTERM");
          }, timeout);
    const settle = (status, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      runningChildren.delete(child);
      if (interrupted === undefined) {
        resolve({ status, signal, error, stdout, stderr });
      } else {
        reject(new CheckFailure(`interrupted by ${interrupted}`));
      }
    };
    // "error" without a pid means the child never started (no "close" follows then).
    child.once("error", (spawnError) => {
      error ??= spawnError;
      if (child.pid === undefined) settle(null, null);
    });
    child.once("close", settle);
  });
}

async function spawnChecked(label, command, args, options) {
  const result = await spawnAsync(command, args, {
    stdio: "inherit",
    timeout: RUN_TIMEOUT_MS,
    ...options,
  });
  if (result.error !== undefined) {
    throw startFailure(label, result.error, options?.timeout ?? RUN_TIMEOUT_MS);
  }
  if (result.status !== 0) {
    throw new CheckFailure(`${label} ${exitDescription(result)}`);
  }
  return result;
}

export function run(command, args, options) {
  return spawnChecked(`${command} ${args[0]}`, command, args, options);
}

// The flags every scratch `npm install` passes. The config flags (legacy-peer-deps, force,
// engine-strict, omit) are set on the command line because a flag beats the caller's ~/.npmrc and
// npm_config_* environment: a developer with legacy-peer-deps or force turned on would otherwise get
// an install that succeeds on a peer range that is too wide, and the ERESOLVE check would pass
// locally and fail only on CI. engine-strict=false keeps the Node 20.19.0 smoke leg on its
// EBADENGINE warning (file-type asks for Node 22), and an empty --omit= keeps the mailer peer
// installed when the caller omits peers.
// --ignore-scripts: no floating package needs a lifecycle script for these checks, and running
// none keeps what a leg installs from executing code.
export const INSTALL_FLAGS = [
  "--save-exact",
  "--no-audit",
  "--no-fund",
  "--legacy-peer-deps=false",
  "--force=false",
  "--engine-strict=false",
  "--omit=",
  "--ignore-scripts",
];

// npm's JavaScript entry point: the one npm that launched this script (`npm run` sets
// npm_execpath, and npx sets it to npx-cli.js, which is ignored), else the npm that ships next to
// the Node running this script (<prefix>/lib/node_modules/npm on POSIX, <node dir>/node_modules/npm
// on Windows).
function findNpmCli() {
  const fromEnv = process.env.npm_execpath;
  if (
    fromEnv !== undefined &&
    path.basename(fromEnv) === "npm-cli.js" &&
    isRegularFile(fromEnv)
  ) {
    return fromEnv;
  }
  const nodeDir = path.dirname(process.execPath);
  return [
    path.join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ].find(isRegularFile);
}

// npm is run as `node npm-cli.js ...` so that no shell is needed on any platform. The bare command
// `npm` is `npm.cmd` on Windows: spawning "npm" fails with ENOENT there, and Node 20.12 and
// later refuse to spawn a .cmd file without a shell (EINVAL, CVE-2024-27980). A shell is what
// shell: false exists to avoid, so it is not the way around that. If no npm-cli.js is found, the
// bare `npm` on PATH is the fallback.
export function runNpm(args, options) {
  const cli = findNpmCli();
  const npmOptions = { timeout: NPM_TIMEOUT_MS, ...options };
  return cli === undefined
    ? spawnChecked(`npm ${args[0]}`, "npm", args, npmOptions)
    : spawnChecked(
        `npm ${args[0]}`,
        process.execPath,
        [cli, ...args],
        npmOptions
      );
}

// The version of a package installed in a scratch project.
export function installedVersion(scratch, name) {
  return JSON.parse(
    readFileSync(
      path.join(scratch, "node_modules", name, "package.json"),
      "utf8"
    )
  ).version;
}

// realpathSync.native: on macOS os.tmpdir() is under /var, a symlink to /private/var, and a
// consumer project that resolves modules through the other spelling would see two copies.
export function makeScratch(prefix) {
  return realpathSync.native(mkdtempSync(path.join(os.tmpdir(), prefix)));
}

// Removes a directory the script created. It never throws, so each removal in a `finally` runs even
// when an earlier one failed, and a cleanup problem cannot turn a passing run into a failure or hide
// the error of a failing one (on Windows a scanner or a busy file makes the removal fail with EBUSY,
// EPERM or ENOTEMPTY, which `force` does not cover). The retries ride out a brief lock; a removal
// that still fails is reported on stderr as a warning that names the directory.
export function removeDirectory(dir) {
  try {
    rmSync(dir, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  } catch (error) {
    console.error(
      `warning: could not remove ${dir}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function isRegularFile(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

// Returns the tarball to install and a cleanup for whatever was created to produce it.
export async function resolveTarball(tarballArg) {
  if (tarballArg !== undefined) {
    const tarball = path.resolve(tarballArg);
    if (!tarball.endsWith(".tgz") || !isRegularFile(tarball)) {
      throw new CheckFailure(
        `usage: --tarball must be an existing .tgz file, got ${tarballArg}`
      );
    }
    return { tarball, cleanup: () => {} };
  }

  if (Number.parseInt(process.versions.node, 10) < 22) {
    throw new CheckFailure(
      "packing needs Node 22 or newer (tsdown); pack on Node 22 and pass --tarball"
    );
  }
  const dir = makeScratch("react-adapter-pack-");
  const cleanup = () => removeDirectory(dir);
  try {
    // The destination must already exist (npm does not create it). `npm pack --json` is not parsed:
    // prepack writes the tsdown output to stdout ahead of the JSON.
    await runNpm(["pack", "--pack-destination", dir], { cwd: repoRoot });
    const found = readdirSync(dir).filter((name) => name.endsWith(".tgz"));
    if (found.length !== 1) {
      throw new CheckFailure(
        `npm pack produced ${found.length} tarballs in ${dir}, expected exactly 1`
      );
    }
    return { tarball: path.join(dir, found[0]), cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

// A compiled CommonJS template shaped like test/fixtures/tsc-cjs.js. __esModule is required for
// `exports.default` to be taken as the component. The h1 holds ONE string child so React does not
// put a `<!-- -->` separator inside it. It is written into each scratch project so that `react`
// resolves there, and kept as a string because a committed .cjs would fail eslint's no-undef.
export const WELCOME_TEMPLATE_SOURCE = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = Welcome;
const jsx_runtime_1 = require("react/jsx-runtime");
function Welcome({ name }) {
  return (0, jsx_runtime_1.jsxs)("div", {
    children: [
      (0, jsx_runtime_1.jsx)("h1", { id: "greeting", children: "Hello " + name }),
      (0, jsx_runtime_1.jsx)("p", { children: "Thanks for joining." }),
    ],
  });
}
`;
