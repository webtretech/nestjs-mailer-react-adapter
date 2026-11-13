import { spawnSync } from "node:child_process";
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

// An argv array with no shell, so nothing a caller passes is ever interpreted by a shell.
function spawnChecked(label, command, args, options) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
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
// `npm` is `npm.cmd` on Windows: spawnSync("npm") fails with ENOENT there, and Node 20.12 and
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

function isRegularFile(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

// Returns the tarball to install and a cleanup for whatever was created to produce it.
export function resolveTarball(tarballArg) {
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
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  try {
    // The destination must already exist (npm does not create it). `npm pack --json` is not parsed:
    // prepack writes the tsdown output to stdout ahead of the JSON.
    runNpm(["pack", "--pack-destination", dir], { cwd: repoRoot });
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
