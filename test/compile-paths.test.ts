import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

// test/COMPILE-PATHS.md lists every compile() path with the test that exercises it. This file checks that list
// against the suite on every `npm test`: a row that cites a file or a test title that does not
// exist, a test file that no row cites, or an area with no row fails here.

const AREAS = [
  "mail",
  "resolver",
  "confinement",
  "loader",
  "renderer",
  "text options",
  "callback count",
] as const;

const MIN_CONFINEMENT_ROWS = 15;
const SELF = "test/compile-paths.test.ts";
// Documentation checks and tests of the test helpers: they exercise no compile() path, so no row cites them.
const NOT_COMPILE_TESTS = new Set([
  "test/docs.test.ts",
  "test/helpers.test.ts",
]);
const SCRIPT_OWNER = "scripts/verify-build.mjs";
const HEADER = "| Area | compile() path | File | Test |";
const PLACEHOLDER = /\bno test yet\b|\bTODO\b|^none$/i;

interface Row {
  area: string;
  path: string;
  file: string;
  test: string;
}

// Cell padding is the only thing removed from a cell: no case folding, no Unicode normalisation.
function cellsOf(line: string): string[] | null {
  if (!line.endsWith("|")) return null;
  return line
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.replace(/^ +| +$/g, ""));
}

function parseRows(markdown: string): { rows: Row[]; problems: string[] } {
  const problems: string[] = [];
  const rows: Row[] = [];
  const tableLines = markdown
    .split(/\r?\n/)
    .filter((line) => line.startsWith("|"));
  if (tableLines.length === 0) {
    problems.push("the map has no table");
    return { rows, problems };
  }
  if (tableLines[0] !== HEADER) {
    problems.push(`the table header is not "${HEADER}"`);
  }
  const body = tableLines.slice(1);
  if (body.length > 0 && /^\|[-| :]+$/.test(body[0])) body.shift();
  for (const line of body) {
    const cells = cellsOf(line);
    if (cells === null || cells.length !== 4) {
      problems.push(`a row does not have exactly four cells: ${line}`);
      continue;
    }
    const [area, mapPath, file, title] = cells;
    rows.push({ area, path: mapPath, file, test: title });
  }
  return { rows, problems };
}

// The checks below read test sources as text. They first blank everything that is not code (comments and the
// bodies of string, template and regular-expression literals) so that a title or a label that only sits in a
// comment or in another string is never mistaken for a real call. The mask keeps every offset unchanged.
const REGEX_PRECEDERS = "(,=:[!&|?{};";

// Known limits, all of which fail loudly (the map check reports a missing title) and none of which occurs in the
// current test files: a tagged-template each (test.each`a|b`("title", ...)) is not read as a test, a
// single-quoted title with an escape ('it\'s') is compared with its backslash, and a regex literal after a
// keyword other than return, typeof, case and throw can still hide the tests that follow it.
function maskNonCode(source: string): string {
  const out = source.split("");
  let i = 0;
  let last = "";
  const blank = (from: number, to: number): void => {
    for (let k = from; k < Math.min(to, out.length); k++) {
      if (out[k] !== "\n" && out[k] !== "\r") out[k] = " ";
    }
  };
  const quoted = (quote: string): void => {
    const start = i++;
    while (i < source.length && source[i] !== quote) {
      i += source[i] === "\\" ? 2 : 1;
    }
    blank(start + 1, i);
    i++;
  };
  const regex = (): boolean => {
    let k = i + 1;
    let inClass = false;
    while (k < source.length && source[k] !== "\n") {
      if (source[k] === "\\") k++;
      else if (source[k] === "[") inClass = true;
      else if (source[k] === "]") inClass = false;
      else if (source[k] === "/" && !inClass) {
        blank(i + 1, k);
        i = k + 1;
        return true;
      }
      k++;
    }
    return false;
  };
  // A slash after one of these words starts a regex literal, not a division.
  const afterKeyword = (): boolean =>
    /(?:^|[^\w$.])(?:return|typeof|case|throw)\s*$/.test(
      source.slice(Math.max(0, i - 40), i)
    );
  const template = (): void => {
    i++;
    let from = i;
    while (i < source.length && source[i] !== "`") {
      if (source[i] === "\\") {
        i += 2;
      } else if (source[i] === "$" && source[i + 1] === "{") {
        blank(from, i);
        i += 2;
        const inner = i;
        code(true);
        // Code inside ${...} is never a test declaration, so it is blanked like the rest of the literal.
        blank(inner, i);
        i++;
        from = i;
      } else {
        i++;
      }
    }
    blank(from, i);
    i++;
  };
  const code = (stopAtBrace: boolean): void => {
    let depth = 0;
    while (i < source.length) {
      const ch = source[i];
      if (ch === "/" && source[i + 1] === "/") {
        const start = i;
        while (i < source.length && source[i] !== "\n") i++;
        blank(start, i);
      } else if (ch === "/" && source[i + 1] === "*") {
        const end = source.indexOf("*/", i + 2);
        const stop = end === -1 ? source.length : end + 2;
        blank(i, stop);
        i = stop;
      } else if (ch === '"' || ch === "'") {
        quoted(ch);
        last = ch;
      } else if (ch === "`") {
        template();
        last = ch;
      } else if (
        ch === "/" &&
        (last === "" || REGEX_PRECEDERS.includes(last) || afterKeyword()) &&
        regex()
      ) {
        last = "/";
      } else {
        if (ch === "{") depth++;
        if (ch === "}") {
          if (stopAtBrace && depth === 0) return;
          depth--;
        }
        if (!/\s/.test(ch)) last = ch;
        i++;
      }
    }
  };
  code(false);
  return out.join("");
}

interface TestTitle {
  raw: string;
  quote: string;
  live: boolean;
}

// Modifiers that take arguments before the title call: test.each(table)("title"), test.skipIf(cond)("title").
const FACTORY_MODIFIERS = new Set(["each", "for", "skipIf", "runIf"]);

function closeOfParen(masked: string, open: number): number {
  let depth = 0;
  for (let k = open; k < masked.length; k++) {
    if (masked[k] === "(") depth++;
    else if (masked[k] === ")" && --depth === 0) return k + 1;
  }
  return -1;
}

// The generic type arguments of test.each<[string, string]>(...); `=>` inside them does not close anything.
function closeOfAngle(masked: string, open: number): number {
  let depth = 0;
  for (let k = open; k < masked.length; k++) {
    if (masked[k] === "<") depth++;
    else if (masked[k] === ">" && masked[k - 1] !== "=" && --depth === 0) {
      return k + 1;
    }
  }
  return -1;
}

function closeOfBrace(masked: string, open: number): number {
  let depth = 0;
  for (let k = open; k < masked.length; k++) {
    if (masked[k] === "{") depth++;
    else if (masked[k] === "}" && --depth === 0) return k + 1;
  }
  return -1;
}

// Every test(...) / it(...) call whose first argument is a plain string literal. `live` is false for
// test.skip and test.todo, for a test inside describe.skip or describe.todo, and for a test whose options
// object has skip or todo set to anything but false; the conditional forms skipIf and runIf are real tests that
// run on one OS. A title that continues after its closing quote (a concatenation) is not a plain literal and is
// not returned, so no row can match it.
function testTitles(source: string): TestTitle[] {
  const masked = maskNonCode(source);
  const titles: TestTitle[] = [];
  const skippedSuites: [number, number][] = [];
  for (const head of masked.matchAll(
    /(?<![\w$.])(?:test|it|describe)(?![\w$])/g
  )) {
    let pos = head.index + head[0].length;
    let live = true;
    for (;;) {
      const modifier = /^\.([A-Za-z_$][\w$]*)/.exec(masked.slice(pos));
      if (modifier === null) break;
      pos += modifier[0].length;
      if (modifier[1] === "skip" || modifier[1] === "todo") live = false;
      if (FACTORY_MODIFIERS.has(modifier[1]) && masked[pos] === "<") {
        pos = closeOfAngle(masked, pos);
        if (pos < 0) break;
      }
      if (FACTORY_MODIFIERS.has(modifier[1]) && masked[pos] === "(") {
        pos = closeOfParen(masked, pos);
        if (pos < 0) break;
      }
    }
    if (pos < 0) continue;
    while (/\s/.test(masked[pos] ?? "")) pos++;
    if (masked[pos] !== "(") continue;
    if (head[0] === "describe") {
      const end = closeOfParen(masked, pos);
      if (!live && end > 0) skippedSuites.push([head.index, end]);
      continue;
    }
    if (
      skippedSuites.some(([from, to]) => head.index >= from && head.index < to)
    ) {
      live = false;
    }
    pos++;
    while (/\s/.test(masked[pos] ?? "")) pos++;
    const quote = masked[pos];
    if (quote !== '"' && quote !== "'" && quote !== "`") continue;
    const close = masked.indexOf(quote, pos + 1);
    if (close < 0 || masked.slice(pos + 1, close).trim() !== "") continue;
    let after = close + 1;
    while (/\s/.test(masked[after] ?? "")) after++;
    if (masked[after] !== "," && masked[after] !== ")") continue;
    if (masked[after] === ",") {
      after++;
      while (/\s/.test(masked[after] ?? "")) after++;
      const end = masked[after] === "{" ? closeOfBrace(masked, after) : -1;
      if (
        end > 0 &&
        /\b(?:skip|todo)\s*:\s*(?!false\b)\S/.test(masked.slice(after, end))
      ) {
        live = false;
      }
    }
    titles.push({ raw: source.slice(pos + 1, close), quote, live });
  }
  return titles;
}

// The static labels the script puts after `${entry.label} ` in its `where` strings.
function scriptLabels(source: string): string[] {
  const masked = maskNonCode(source);
  const labels: string[] = [];
  for (const head of masked.matchAll(/\bwhere\s*=\s*`/g)) {
    const open = head.index + head[0].length - 1;
    const close = masked.indexOf("`", open + 1);
    if (close < 0) continue;
    const raw = source.slice(open + 1, close);
    const label = /^\$\{entry\.label\} ([^$`]+)$/.exec(raw);
    if (label !== null) labels.push(label[1]);
  }
  return labels;
}

function validateMap(
  markdown: string,
  sources: ReadonlyMap<string, string>,
  testFiles: readonly string[]
): string[] {
  const { rows, problems } = parseRows(markdown);
  if (rows.length === 0) problems.push("the map has no rows");

  const cited = new Set<string>();
  for (const row of rows) {
    const where = `row "${row.path}"`;
    const cells: [string, string][] = [
      ["Area", row.area],
      ["compile() path", row.path],
      ["File", row.file],
      ["Test", row.test],
    ];
    let usable = true;
    for (const [name, value] of cells) {
      if (value === "") {
        problems.push(`${where}: the ${name} cell is empty`);
        usable = false;
      } else if (PLACEHOLDER.test(value)) {
        problems.push(`${where}: the ${name} cell is a placeholder: ${value}`);
        usable = false;
      }
    }
    if (!(AREAS as readonly string[]).includes(row.area)) {
      problems.push(`${where}: unknown area "${row.area}"`);
    }
    if (!usable) continue;

    cited.add(row.file);
    const source = sources.get(row.file);
    if (source === undefined) {
      problems.push(`${where}: the file ${row.file} does not exist`);
    } else if (row.file === SCRIPT_OWNER) {
      if (!scriptLabels(source).includes(row.test)) {
        problems.push(
          `${where}: ${row.file} has no check labelled ${row.test}`
        );
      }
    } else if (/^test\/[^/]+\.test\.ts$/.test(row.file)) {
      const matching = testTitles(source).filter((title) =>
        title.quote === '"'
          ? title.raw === JSON.stringify(row.test).slice(1, -1)
          : title.raw === row.test
      );
      if (matching.length === 0) {
        problems.push(`${where}: ${row.file} has no test titled "${row.test}"`);
      } else if (!matching.some((title) => title.live)) {
        problems.push(
          `${where}: ${row.file} has "${row.test}" only on a skipped or todo test`
        );
      }
    } else {
      problems.push(
        `${where}: ${row.file} is not a test file or ${SCRIPT_OWNER}`
      );
    }
  }

  for (const file of testFiles) {
    if (!cited.has(file)) problems.push(`${file} is cited by no row`);
  }
  for (const area of AREAS) {
    const count = rows.filter((row) => row.area === area).length;
    if (count === 0) problems.push(`the area "${area}" has no row`);
    if (area === "confinement" && count < MIN_CONFINEMENT_ROWS) {
      problems.push(
        `the area "confinement" has ${count} rows, at least ${MIN_CONFINEMENT_ROWS} are required`
      );
    }
  }
  return problems;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readRepoFile(file: string): Promise<string | undefined> {
  try {
    return await readFile(path.join(ROOT, ...file.split("/")), "utf8");
  } catch {
    return undefined;
  }
}

async function loadSuite(): Promise<{
  markdown: string;
  sources: Map<string, string>;
  testFiles: string[];
}> {
  const markdown = await readFile(
    path.join(ROOT, "test", "COMPILE-PATHS.md"),
    "utf8"
  );
  const names = await readdir(path.join(ROOT, "test"));
  const testFiles = names
    .filter((name) => name.endsWith(".test.ts"))
    .map((name) => `test/${name}`)
    .filter((file) => file !== SELF && !NOT_COMPILE_TESTS.has(file))
    .sort();
  const wanted = new Set<string>([
    ...testFiles,
    ...parseRows(markdown).rows.map((row) => row.file),
  ]);
  const sources = new Map<string, string>();
  for (const file of wanted) {
    const source = await readRepoFile(file);
    if (source !== undefined) sources.set(file, source);
  }
  return { markdown, sources, testFiles };
}

function lineOf(markdown: string, predicate: (line: string) => boolean) {
  const line = markdown.split(/\r?\n/).find(predicate);
  if (line === undefined) throw new Error("no matching row in the map");
  return line;
}

describe("the compile() path list", () => {
  test("test/COMPILE-PATHS.md cites only files and titles that exist, covers every test file and every area", async () => {
    const { markdown, sources, testFiles } = await loadSuite();
    expect(validateMap(markdown, sources, testFiles)).toEqual([]);
  });

  test("a title that differs from the source by one character is reported", async () => {
    const { markdown, sources, testFiles } = await loadSuite();
    const row = lineOf(markdown, (line) =>
      /\| test\/[^|]+\.test\.ts \|/.test(line)
    );
    const cells = cellsOf(row);
    expect(cells).not.toBeNull();
    const title = (cells as string[])[3];
    const changed = title.slice(0, -1) + (title.endsWith("x") ? "y" : "x");
    const altered = markdown.replace(
      row,
      row.replace(`| ${title} |`, `| ${changed} |`)
    );
    expect(altered).not.toBe(markdown);
    const problems = validateMap(altered, sources, testFiles);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(changed);
  });

  test("an area with no row is reported, one row is enough, and confinement fails below fifteen rows", async () => {
    const { markdown, sources, testFiles } = await loadSuite();
    const lines = markdown.split(/\r?\n/);
    const rowsOf = (area: string) =>
      lines.filter((line) => line.startsWith(`| ${area} |`));

    const renderer = rowsOf("renderer");
    expect(renderer.length).toBeGreaterThanOrEqual(1);
    const keepOne = lines.filter((line) => !renderer.slice(1).includes(line));
    const mentionsRenderer = (problems: string[]) =>
      problems.filter((p) => p.includes('"renderer"'));
    expect(
      mentionsRenderer(validateMap(keepOne.join("\n"), sources, testFiles))
    ).toEqual([]);
    const dropAll = lines.filter((line) => !renderer.includes(line));
    expect(
      mentionsRenderer(validateMap(dropAll.join("\n"), sources, testFiles))
    ).toEqual(['the area "renderer" has no row']);

    const confinement = rowsOf("confinement");
    expect(confinement.length).toBeGreaterThanOrEqual(15);
    const dropped = (keep: number) =>
      lines.filter((line) => !confinement.slice(keep).includes(line));
    const atLimit = validateMap(dropped(15).join("\n"), sources, testFiles);
    // Rows removed here may leave a test file uncited; only the threshold message is under test.
    expect(atLimit.filter((p) => p.includes('"confinement"'))).toEqual([]);
    const belowLimit = validateMap(dropped(14).join("\n"), sources, testFiles);
    expect(belowLimit).toContain(
      'the area "confinement" has 14 rows, at least 15 are required'
    );
  });

  test("a cell reading no test yet, TODO or none is reported", async () => {
    const { markdown, sources, testFiles } = await loadSuite();
    const row = lineOf(markdown, (line) =>
      /\| test\/[^|]+\.test\.ts \|/.test(line)
    );
    const cells = cellsOf(row) as string[];
    for (const placeholder of ["no test yet", "TODO", "none", ""]) {
      const replaced = markdown.replace(
        row,
        `| ${cells[0]} | ${cells[1]} | ${cells[2]} | ${placeholder} |`
      );
      const problems = validateMap(replaced, sources, testFiles);
      expect(problems.length, `cell "${placeholder}"`).toBeGreaterThan(0);
    }
  });

  test("a test file that no row cites is reported", async () => {
    const { markdown, sources, testFiles } = await loadSuite();
    const problems = validateMap(markdown, sources, [
      ...testFiles,
      "test/uncited.test.ts",
    ]);
    expect(problems).toEqual(["test/uncited.test.ts is cited by no row"]);
  });

  test("an empty map and a header-only map are reported", async () => {
    const { markdown, sources, testFiles } = await loadSuite();
    expect(validateMap("", sources, testFiles).length).toBeGreaterThan(0);
    const header = markdown
      .split(/\r?\n/)
      .filter((line) => line.startsWith("|"))
      .slice(0, 2)
      .join("\n");
    expect(validateMap(header, sources, testFiles)).toContain(
      "the map has no rows"
    );
  });

  // One row for one cited title or label, checked against an in-memory source; the area rules are not under test.
  function rowProblems(file: string, title: string, source: string): string[] {
    const row = `| mail | one path | ${file} | ${title} |`;
    const map = [HEADER, "| --- | --- | --- | --- |", row].join("\n");
    return validateMap(map, new Map([[file, source]]), []).filter((problem) =>
      problem.startsWith('row "one path"')
    );
  }
  const code = (...lines: string[]): string => lines.join("\n");

  test("a title that real test calls carry is accepted, including each, skipIf and runIf", () => {
    const source = code(
      'test("plain title", () => {});',
      "it('single quoted', () => {});",
      'test.each([1, 2])("each title %s", () => {});',
      'test.each<[string, number]>([["a", 1]])("typed each %s", () => {});',
      'test.skipIf(process.platform === "win32")("skipIf title", () => {});',
      'it.runIf(isLinux())("runIf title", () => {});',
      "test(",
      '  "title on its own line",',
      "  () => {}",
      ");"
    );
    for (const title of [
      "plain title",
      "single quoted",
      "each title %s",
      "typed each %s",
      "skipIf title",
      "runIf title",
      "title on its own line",
    ]) {
      expect(rowProblems("test/x.test.ts", title, source), title).toEqual([]);
    }
  });

  test("a title that only appears in a comment is reported", () => {
    for (const source of [
      code(
        '// test("only in a comment", () => {});',
        'test("other", () => {});'
      ),
      code('/* test("only in a comment", () => {}); */'),
      code("/*", '  it("only in a comment", () => {});', "*/"),
    ]) {
      const problems = rowProblems(
        "test/x.test.ts",
        "only in a comment",
        source
      );
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('has no test titled "only in a comment"');
    }
  });

  test("a title that only appears inside another string is reported", () => {
    const source = code(
      "const text = 'test(\"only in a string\", () => {})';",
      'expect(text, "only in a string").toBeDefined();'
    );
    const problems = rowProblems("test/x.test.ts", "only in a string", source);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('has no test titled "only in a string"');
  });

  test("a title that only appears on a skipped or todo test is reported", () => {
    for (const head of ["test.skip", "it.skip", "test.todo", "it.todo"]) {
      const source = code(`${head}("only skipped", () => {});`);
      const problems = rowProblems("test/x.test.ts", "only skipped", source);
      expect(problems, head).toHaveLength(1);
      expect(problems[0]).toContain("only on a skipped or todo test");
    }
    const alsoLive = code(
      'test.skip("both", () => {});',
      'test("both", () => {});'
    );
    expect(rowProblems("test/x.test.ts", "both", alsoLive)).toEqual([]);
  });

  test("a title that only appears on a describe is reported", () => {
    for (const head of ["describe", "describe.each([1])", "describe.skip"]) {
      const source = code(`${head}("only a suite", () => {});`);
      const problems = rowProblems("test/x.test.ts", "only a suite", source);
      expect(problems, head).toHaveLength(1);
      expect(problems[0]).toContain('has no test titled "only a suite"');
    }
  });

  test("a title that only appears under a skipped or todo describe is reported", () => {
    for (const head of ["describe.skip", "describe.todo"]) {
      const source = code(
        `${head}("suite", () => {`,
        '  test("nested", () => {});',
        "});",
        'test("outside", () => {});'
      );
      const nested = rowProblems("test/x.test.ts", "nested", source);
      expect(nested, head).toHaveLength(1);
      expect(nested[0]).toContain("only on a skipped or todo test");
      // The skip ends with the describe call: a later test is live again.
      expect(rowProblems("test/x.test.ts", "outside", source), head).toEqual(
        []
      );
    }
    const live = code(
      'describe("suite", () => {',
      '  test("nested", () => {});',
      "});"
    );
    expect(rowProblems("test/x.test.ts", "nested", live)).toEqual([]);
  });

  test("a title whose options object skips or todos the test is reported", () => {
    for (const options of ["{ skip: true }", "{ todo: true }"]) {
      const source = code(`test("optioned", ${options}, () => {});`);
      const problems = rowProblems("test/x.test.ts", "optioned", source);
      expect(problems, options).toHaveLength(1);
      expect(problems[0]).toContain("only on a skipped or todo test");
    }
    for (const options of ["{ skip: false }", "{ timeout: 5000 }"]) {
      const source = code(`test("optioned", ${options}, () => {});`);
      expect(
        rowProblems("test/x.test.ts", "optioned", source),
        options
      ).toEqual([]);
    }
  });

  test("a title built by concatenation matches no row, not even one citing its first part", () => {
    const source = code('test("part one" + " part two", () => {});');
    for (const title of ["part one", "part one part two"]) {
      const problems = rowProblems("test/x.test.ts", title, source);
      expect(problems, title).toHaveLength(1);
      expect(problems[0]).toContain(`has no test titled "${title}"`);
    }
  });

  test("a test call inside a template literal interpolation is not counted", () => {
    const source = code(
      'const body = `${ test("in a template", () => {}) }`;',
      'test("after the template", () => {});'
    );
    const inside = rowProblems("test/x.test.ts", "in a template", source);
    expect(inside).toHaveLength(1);
    expect(inside[0]).toContain('has no test titled "in a template"');
    expect(rowProblems("test/x.test.ts", "after the template", source)).toEqual(
      []
    );
  });

  test("a regular expression after return does not hide the tests that follow it", () => {
    const source = code(
      'function f(s: string) { return /"x/.test(s); }',
      'test("after a return regex", () => {});'
    );
    expect(
      rowProblems("test/x.test.ts", "after a return regex", source)
    ).toEqual([]);
  });

  test("a verify-build label counts only inside a where string", () => {
    const where = (label: string): string =>
      "const where = `$" + `{entry.label} ${label}\`;`;
    expect(
      rowProblems("scripts/verify-build.mjs", "escape", where("escape"))
    ).toEqual([]);
    for (const source of [
      code("// escape", where("confinement")),
      code('const label = "escape";', where("confinement")),
      code("/* const where = `$" + "{entry.label} escape` */", where("other")),
      code(where("escape-hatch")),
    ]) {
      const problems = rowProblems(
        "scripts/verify-build.mjs",
        "escape",
        source
      );
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("has no check labelled escape");
    }
  });

  test("CRLF line endings do not change the verdict", async () => {
    const { markdown, sources, testFiles } = await loadSuite();
    const crlf = markdown.replace(/\r?\n/g, "\r\n");
    expect(crlf).toContain("\r\n");
    expect(validateMap(crlf, sources, testFiles)).toEqual([]);
  });
});
