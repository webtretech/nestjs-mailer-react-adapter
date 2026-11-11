import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

// test/COMPILE-PATHS.md lists every compile() path with the test that exercises it. This file checks that list
// against the suite on every `npm test` (TEST-01, D-15): a row that cites a file or a test title that does not
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
      if (!source.includes(row.test)) {
        problems.push(
          `${where}: ${row.file} has no check labelled ${row.test}`
        );
      }
    } else if (/^test\/[^/]+\.test\.ts$/.test(row.file)) {
      const literals = [
        JSON.stringify(row.test),
        `'${row.test}'`,
        `\`${row.test}\``,
      ];
      if (!literals.some((literal) => source.includes(literal))) {
        problems.push(`${where}: ${row.file} has no test titled "${row.test}"`);
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
    .filter((file) => file !== SELF)
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

describe("the compile() path list (TEST-01, D-15)", () => {
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

  test("CRLF line endings do not change the verdict", async () => {
    const { markdown, sources, testFiles } = await loadSuite();
    const crlf = markdown.replace(/\r?\n/g, "\r\n");
    expect(crlf).toContain("\r\n");
    expect(validateMap(crlf, sources, testFiles)).toEqual([]);
  });
});
