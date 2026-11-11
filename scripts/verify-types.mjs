import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const packageName = "@webtre/nestjs-mailer-react-adapter";

// A failed check throws rather than calling process.exit(), which would skip the `finally` that
// removes the temp directory; the catch at the bottom prints the FAIL line.
class VerifyFailure extends Error {}

function fail(message) {
  throw new VerifyFailure(message);
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

const expectedExports = [
  "HtmlToTextConfig",
  "REACT_ADAPTER_ERROR_CODES",
  "ReactAdapter",
  "ReactAdapterError",
  "ReactAdapterErrorCode",
  "ReactAdapterOptions",
];

// The same shape as the 0.2.x htmlToTextOptions leak: a type imported from a module that does
// not resolve is `any` once skipLibCheck hides the error.
const canaryDeclarations = `import type { Missing } from "any-canary-missing";
export declare class AnyCanary {
  constructor(options?: { leak?: Missing });
}
`;

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

// Reports a path for every `any` reachable from the exports of moduleSymbol through types
// declared under ownRoot. A type declared elsewhere is checked as a reference (the type itself
// and its type arguments) but its members are not walked: they belong to another package.
function findAny(checker, moduleSymbol, anchor, ownRoot) {
  const findings = [];
  const visited = new Set();
  const exportNames = [];

  const declaredHere = (declaration) =>
    path
      .resolve(declaration.getSourceFile().fileName)
      .startsWith(ownRoot + path.sep);
  const symbolDeclaredHere = (symbol) =>
    symbol?.declarations?.some(declaredHere) ?? false;
  const isHidden = (declaration) =>
    (ts.getCombinedModifierFlags(declaration) &
      (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) !==
      0 ||
    (declaration.name !== undefined &&
      ts.isPrivateIdentifier(declaration.name));

  function walkSignatures(type, kind, label, where) {
    for (const signature of checker.getSignaturesOfType(type, kind)) {
      const declaration = signature.getDeclaration();
      if (declaration && !declaredHere(declaration)) continue;
      for (const parameter of signature.getParameters()) {
        walk(
          checker.getTypeOfSymbolAtLocation(parameter, anchor),
          `${where}.${label}(${parameter.name})`
        );
      }
      walk(checker.getReturnTypeOfSignature(signature), `${where}.${label}()`);
    }
  }

  function walkMembers(type, where) {
    for (const property of checker.getPropertiesOfType(type)) {
      const declarations = property.declarations ?? [];
      if (declarations.length > 0 && !declarations.some(declaredHere)) continue;
      if (declarations.some(isHidden)) continue;
      walk(
        checker.getTypeOfSymbolAtLocation(property, anchor),
        `${where}.${property.name}`
      );
    }
    walkSignatures(type, ts.SignatureKind.Call, "call", where);
    walkSignatures(type, ts.SignatureKind.Construct, "new", where);
    for (const info of checker.getIndexInfosOfType(type)) {
      walk(info.type, `${where}[index]`);
    }
  }

  function walk(type, where) {
    if (type.flags & ts.TypeFlags.Any) {
      if (!findings.includes(where)) findings.push(where);
      return;
    }
    if (visited.has(type)) return;
    visited.add(type);
    if (type.isUnionOrIntersection()) {
      for (const member of type.types) walk(member, where);
      return;
    }
    if (type.flags & ts.TypeFlags.TypeParameter) {
      const constraint = checker.getBaseConstraintOfType(type);
      if (constraint && constraint !== type) walk(constraint, where);
      return;
    }
    for (const argument of type.aliasTypeArguments ?? []) {
      walk(argument, `${where}<alias>`);
    }
    if (
      type.flags & ts.TypeFlags.Object &&
      type.objectFlags & ts.ObjectFlags.Reference
    ) {
      for (const argument of checker.getTypeArguments(type)) {
        walk(argument, `${where}<type argument>`);
      }
    }
    if (symbolDeclaredHere(type.aliasSymbol ?? type.symbol)) {
      walkMembers(type, where);
    }
  }

  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    exportNames.push(exported.name);
    const symbol =
      exported.flags & ts.SymbolFlags.Alias
        ? checker.getAliasedSymbol(exported)
        : exported;
    if (symbol.flags & ts.SymbolFlags.Value) {
      walk(
        checker.getTypeOfSymbolAtLocation(symbol, anchor),
        `${exported.name}`
      );
    }
    if (
      symbol.flags &
      (ts.SymbolFlags.Class |
        ts.SymbolFlags.Interface |
        ts.SymbolFlags.TypeAlias |
        ts.SymbolFlags.Enum)
    ) {
      walk(checker.getDeclaredTypeOfSymbol(symbol), `${exported.name}`);
    }
  }
  return { findings, exportNames: exportNames.sort() };
}

// Resolves an import of the probe to its module symbol, with the import as the location anchor.
function moduleOf(program, file, specifier) {
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(file);
  const declaration = sourceFile?.statements.find(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === specifier
  );
  const symbol = declaration
    ? checker.getSymbolAtLocation(declaration.moduleSpecifier)
    : undefined;
  if (!declaration || !symbol) {
    fail(`${path.basename(file)}: cannot resolve ${specifier}`);
  }
  return { checker, symbol, anchor: declaration };
}

function checkCanary(dir) {
  const canaryDir = path.join(dir, "node_modules", "any-canary");
  mkdirSync(canaryDir, { recursive: true });
  writeFileSync(
    path.join(canaryDir, "package.json"),
    JSON.stringify({ name: "any-canary", types: "index.d.ts" })
  );
  writeFileSync(path.join(canaryDir, "index.d.ts"), canaryDeclarations);
  const file = path.join(dir, "canary.mts");
  writeFileSync(
    file,
    'import { AnyCanary } from "any-canary";\nexport { AnyCanary };\n'
  );
  const program = createProgram(dir, ["canary.mts"], configurations[0].options);
  const { checker, symbol, anchor } = moduleOf(program, file, "any-canary");
  const { findings } = findAny(checker, symbol, anchor, canaryDir);
  if (findings.length !== 1 || !findings[0].includes("leak")) {
    fail(
      `walker is blind: expected exactly one canary finding naming leak, got ${JSON.stringify(findings)}`
    );
  }
  return findings[0];
}

function checkDeclarations() {
  for (const entry of ["index.d.cts", "index.d.mts"]) {
    const text = readFileSync(path.join(root, "dist", entry), "utf8");
    if (text.includes("@react-email/")) {
      fail(
        `dist/${entry} references the render package, consumers would inherit its types`
      );
    }
  }
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

let created;
try {
  for (const entry of ["index.d.cts", "index.d.mts"]) {
    if (!existsSync(path.join(root, "dist", entry))) {
      fail(`dist/${entry} is missing, run npm run build first`);
    }
  }

  created = mkdtempSync(path.join(os.tmpdir(), "react-adapter-types-"));
  const dir = realpathSync(created);
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

  const canary = checkCanary(dir);
  const { programs, checks } = checkProbes(dir);

  // Both declaration files are walked: the node16 ESM probe resolves index.d.mts, the CJS probe index.d.cts.
  const distRoot = realpathSync(path.join(root, "dist"));
  const walked = [];
  for (const [probeFile, declarationFile] of [
    ["esm.mts", "index.d.mts"],
    ["cjs.cts", "index.d.cts"],
  ]) {
    const { checker, symbol, anchor } = moduleOf(
      programs.node16,
      path.join(dir, probeFile),
      packageName
    );
    const resolved = symbol.declarations?.[0]?.getSourceFile().fileName;
    if (resolved === undefined || path.basename(resolved) !== declarationFile) {
      fail(
        `${probeFile} resolved ${resolved ?? "nothing"}, expected ${declarationFile}`
      );
    }
    const { findings, exportNames } = findAny(
      checker,
      symbol,
      anchor,
      distRoot
    );
    if (findings.length > 0) {
      fail(
        `any is reachable from the public API in ${declarationFile}:\n  ${findings.join("\n  ")}`
      );
    }
    if (exportNames.join(",") !== [...expectedExports].sort().join(",")) {
      fail(
        `export names in ${declarationFile} are ${exportNames.join(", ")}, expected ${expectedExports.join(", ")}`
      );
    }
    walked.push(`${exportNames.length} exports of ${declarationFile}`);
  }
  checkDeclarations();

  console.log(
    `verify-types: ok ${checks} probe checks in ${configurations.length} configurations, ${walked.join(" and ")} walked with no any, d.ts files free of render imports, canary reported ${canary}`
  );
} catch (error) {
  console.error(
    `verify-types: FAIL ${
      error instanceof VerifyFailure
        ? error.message
        : `unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`
    }`
  );
  process.exitCode = 1;
} finally {
  if (created !== undefined) rmSync(created, { recursive: true, force: true });
}
