import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  CheckFailure,
  exitDescription,
  INSTALL_FLAGS,
  installedVersion,
  makeScratch,
  repoRoot,
  resolveTarball,
  RUN_TIMEOUT_MS,
  run,
  runNpm,
  startFailure,
} from "./lib/scratch.mjs";

// One example app, built against the packed adapter: copy the example into a fresh scratch directory,
// install the tarball in place of the adapter's registry range, build, boot the built app with a JSON
// transport (no SMTP), send the welcome mail, and run the README's CI recipe in the built app. The
// adapter is only ever loaded from the packed tarball, never from the working tree.

const EXAMPLES = ["nestjs-example", "nestjs-with-swc-example"];

const USAGE =
  "usage: node scripts/examples.mjs nestjs-example|nestjs-with-swc-example [--tarball FILE.tgz] [--keep]";

const ADAPTER = "@webtre/nestjs-mailer-react-adapter";

// Local checkouts hold an untracked .env (SMTP credentials) and a stale gitignored lockfile next to
// the example sources; none of these may reach the scratch app.
const SKIPPED_BASENAMES = new Set([
  "node_modules",
  "dist",
  "package-lock.json",
  ".env",
  "coverage",
]);

const RECIPE_FENCE = /```js\n(\/\/ check-templates\.mjs[^\n]*\n[\s\S]*?)\n```/;

function parseCommand(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: true,
      options: {
        tarball: { type: "string" },
        keep: { type: "boolean", default: false },
      },
    });
  } catch (error) {
    throw new CheckFailure(`usage: ${error.message}`);
  }
  const { values, positionals } = parsed;
  if (positionals.length !== 1 || !EXAMPLES.includes(positionals[0])) {
    throw new CheckFailure(
      `usage: expected exactly one example name (${EXAMPLES.join(" or ")}), got ${JSON.stringify(positionals)}`
    );
  }
  return { name: positionals[0], ...values };
}

// Runs the README recipe file and returns the child's result; stdout and stderr are echoed.
function runRecipe(file, cwd) {
  const result = spawnSync(process.execPath, [file], {
    cwd,
    shell: false,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: RUN_TIMEOUT_MS,
  });
  if (result.error !== undefined) {
    throw startFailure("README recipe", result.error, RUN_TIMEOUT_MS);
  }
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  return result;
}

let scratch;
let tarballCleanup = () => {};
let keep = false;
try {
  const command = parseCommand(process.argv.slice(2));
  keep = command.keep;

  const { tarball, cleanup } = resolveTarball(command.tarball);
  tarballCleanup = cleanup;

  scratch = makeScratch("react-adapter-example-");
  const app = path.join(scratch, command.name);
  cpSync(path.join(repoRoot, "examples", command.name), app, {
    recursive: true,
    filter: (source) => !SKIPPED_BASENAMES.has(path.basename(source)),
  });

  // The example lists the adapter as ^0.3.0 so users can copy it. Before that version is on npm the
  // range fails with ETARGET, and after the release it would install the registry copy instead of
  // the tarball, so the key is removed and the tarball is installed in its place.
  const packageFile = path.join(app, "package.json");
  const examplePackage = JSON.parse(readFileSync(packageFile, "utf8"));
  if (examplePackage.dependencies?.[ADAPTER] === undefined) {
    throw new CheckFailure(`${command.name} does not depend on ${ADAPTER}`);
  }
  delete examplePackage.dependencies[ADAPTER];
  writeFileSync(packageFile, `${JSON.stringify(examplePackage, null, 2)}\n`);

  runNpm(["install", ...INSTALL_FLAGS, tarball], { cwd: app });

  const adapter = installedVersion(app, ADAPTER);
  const mailer = installedVersion(app, "@nestjs-modules/mailer");
  const nodemailer = installedVersion(app, "nodemailer");
  const react = installedVersion(app, "react");
  const nestCore = installedVersion(app, "@nestjs/core");
  console.log(
    `examples: resolved adapter ${adapter} mailer ${mailer} nodemailer ${nodemailer} react ${react} @nestjs/core ${nestCore}`
  );
  const rootVersion = JSON.parse(
    readFileSync(path.join(repoRoot, "package.json"), "utf8")
  ).version;
  if (adapter !== rootVersion) {
    throw new CheckFailure(
      `installed adapter ${adapter} is not the packed ${rootVersion}`
    );
  }
  if (!mailer.startsWith("4.")) {
    throw new CheckFailure(
      `@nestjs-modules/mailer resolved to ${mailer}, expected 4.x`
    );
  }

  // nest build; the SWC example's postbuild runs gulp.
  runNpm(["run", "build"], { cwd: app });
  if (!existsSync(path.join(app, "dist", "templates", "welcome.js"))) {
    throw new CheckFailure("build did not produce dist/templates/welcome.js");
  }

  copyFileSync(
    path.join(import.meta.dirname, "examples", "example.check.mjs"),
    path.join(app, "example.check.mjs")
  );
  run(process.execPath, ["example.check.mjs"], {
    cwd: app,
    env: {
      ...process.env,
      MAIL_TRANSPORT: "json",
      MAIL_FROM_NAME: "Example",
      MAIL_FROM_ADDRESS: "example@example.test",
    },
  });

  // The README recipe, extracted from its fence, in the built app and then against an empty template
  // directory.
  const readme = readFileSync(path.join(repoRoot, "README.md"), "utf8");
  const recipe = RECIPE_FENCE.exec(readme);
  if (recipe === null) {
    throw new CheckFailure("README has no check-templates.mjs recipe");
  }
  const recipeFile = path.join(app, "check-templates.mjs");
  writeFileSync(recipeFile, `${recipe[1]}\n`);

  const positive = runRecipe(recipeFile, app);
  if (positive.status !== 0) {
    throw new CheckFailure(`README recipe ${exitDescription(positive)}`);
  }
  if (!positive.stdout.includes("ok welcome")) {
    throw new CheckFailure("README recipe did not print `ok welcome`");
  }

  const emptyCase = path.join(app, "empty-case");
  mkdirSync(path.join(emptyCase, "dist", "templates"), { recursive: true });
  console.log(
    "examples: the next recipe run must fail (empty template directory)"
  );
  const empty = runRecipe(recipeFile, emptyCase);
  if (empty.status === 0) {
    throw new CheckFailure(
      "README recipe passed on an empty template directory"
    );
  }
  if (!empty.stderr.includes("no compiled templates in")) {
    throw new CheckFailure(
      "README recipe failed on an empty template directory without `no compiled templates in`"
    );
  }

  console.log(
    `examples: ok ${command.name} adapter ${adapter} mailer ${mailer}`
  );
} catch (error) {
  if (error instanceof CheckFailure) {
    console.error(`examples: FAIL ${error.message}`);
    if (error.message.startsWith("usage:")) console.error(USAGE);
  } else {
    console.error(
      `examples: FAIL unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`
    );
  }
  process.exitCode = 1;
} finally {
  if (scratch !== undefined) {
    if (keep) {
      console.log(`examples: kept ${scratch}`);
    } else {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
  tarballCleanup();
}
