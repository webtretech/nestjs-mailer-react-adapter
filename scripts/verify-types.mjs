import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const packageName = "@webtre/nestjs-mailer-react-adapter";

function fail(message) {
  console.error(`verify-types: FAIL ${message}`);
  process.exit(1);
}

const deliberate = "const wrong: number = adapter;";

const probe = `import { ReactAdapter, ReactAdapterError } from "${packageName}";
import type {
  HtmlToTextConfig,
  ReactAdapterErrorCode,
  ReactAdapterOptions,
} from "${packageName}";

const config: HtmlToTextConfig = { wordwrap: 80 };
const options: ReactAdapterOptions = {
  text: true,
  htmlToTextOptions: { wordwrap: 80 },
};
const adapter = new ReactAdapter(options);
const error = new ReactAdapterError("ERR_REACT_ADAPTER_NO_BODY", "m");
const code: ReactAdapterErrorCode = error.code;
${deliberate}
`;

const commonOptions = {
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  target: ts.ScriptTarget.ES2022,
  types: ["node"],
  typeRoots: [path.join(root, "node_modules", "@types")],
};

const configurations = [
  {
    name: "node16",
    options: {
      module: ts.ModuleKind.Node16,
      moduleResolution: ts.ModuleResolutionKind.Node16,
    },
    files: ["cjs.cts", "esm.mts"],
  },
  {
    name: "bundler",
    options: {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
    files: ["cjs.cts", "esm.mts"],
  },
  {
    name: "node10",
    options: {
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
    },
    files: ["legacy.ts"],
  },
];

function createProgram(dir, files, options) {
  const compilerOptions = { ...commonOptions, ...options };
  const host = ts.createCompilerHost(compilerOptions);
  host.getCurrentDirectory = () => dir;
  return ts.createProgram(
    files.map((file) => path.join(dir, file)),
    compilerOptions,
    host
  );
}

function formatDiagnostics(dir, diagnostics) {
  return ts.formatDiagnostics(diagnostics, {
    getCurrentDirectory: () => dir,
    getCanonicalFileName: (file) => file,
    getNewLine: () => "\n",
  });
}

function checkProbes(dir) {
  const deliberateLine =
    probe.split("\n").findIndex((line) => line === deliberate) + 1;
  const programs = {};
  let checks = 0;
  for (const configuration of configurations) {
    const program = createProgram(
      dir,
      configuration.files,
      configuration.options
    );
    programs[configuration.name] = program;
    for (const file of configuration.files) {
      const sourceFile = program.getSourceFile(path.join(dir, file));
      if (!sourceFile) fail(`${configuration.name}: ${file} was not loaded`);
      const diagnostics = ts.getPreEmitDiagnostics(program, sourceFile);
      const expected =
        diagnostics.length === 1 &&
        diagnostics[0].code === 2322 &&
        diagnostics[0].file !== undefined &&
        diagnostics[0].file.getLineAndCharacterOfPosition(
          diagnostics[0].start ?? 0
        ).line +
          1 ===
          deliberateLine;
      if (!expected) {
        fail(
          `${configuration.name} ${file}: expected exactly one TS2322 on line ${deliberateLine}, got ${diagnostics.length}:\n${formatDiagnostics(dir, diagnostics)}`
        );
      }
      checks += 1;
    }
  }
  return { programs, checks };
}

for (const entry of ["index.d.cts", "index.d.mts"]) {
  if (!existsSync(path.join(root, "dist", entry))) {
    fail(`dist/${entry} is missing, run npm run build first`);
  }
}

const dir = mkdtempSync(path.join(os.tmpdir(), "react-adapter-types-"));
try {
  const scope = path.join(dir, "node_modules", "@webtre");
  mkdirSync(scope, { recursive: true });
  symlinkSync(
    root,
    path.join(scope, "nestjs-mailer-react-adapter"),
    process.platform === "win32" ? "junction" : "dir"
  );
  for (const file of ["cjs.cts", "esm.mts", "legacy.ts"]) {
    writeFileSync(path.join(dir, file), probe);
  }

  const { checks } = checkProbes(dir);
  console.log(
    `verify-types: ok ${checks} probe checks in ${configurations.length} configurations`
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
