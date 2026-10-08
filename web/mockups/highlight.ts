import { diffLines } from "diff";
import { createHighlighterCore, type HighlighterCore, type ThemedToken } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

const languages = {
  c: () => import("shiki/langs/c.mjs"),
  csharp: () => import("shiki/langs/csharp.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  dockerfile: () => import("shiki/langs/dockerfile.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  graphql: () => import("shiki/langs/graphql.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  jsonc: () => import("shiki/langs/jsonc.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  kotlin: () => import("shiki/langs/kotlin.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  scss: () => import("shiki/langs/scss.mjs"),
  shellscript: () => import("shiki/langs/shellscript.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  swift: () => import("shiki/langs/swift.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  xml: () => import("shiki/langs/xml.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
} as const;

type Language = keyof typeof languages;

const aliases: Record<string, Language> = {
  bash: "shellscript", sh: "shellscript", shell: "shellscript", zsh: "shellscript", "c#": "csharp", cs: "csharp",
  docker: "dockerfile", gql: "graphql", htm: "html", js: "javascript", mjs: "javascript", cjs: "javascript",
  kt: "kotlin", py: "python", rs: "rust", svg: "xml", ts: "typescript", mts: "typescript", yml: "yaml",
};

export const highlightedLanguages = Object.keys(languages) as Language[];

export function resolveLanguage(language: string | undefined, filename?: string): Language | null {
  const candidate = (language ?? filename?.split(".").pop() ?? "").toLowerCase();
  if (candidate in languages) return candidate as Language;
  return aliases[candidate] ?? null;
}

let highlighter: Promise<HighlighterCore> | undefined;

/** Highlights code with Shiki's JavaScript regex engine, so no WebAssembly or workers are needed. */
export async function highlightLines(code: string, language: string | undefined, filename?: string): Promise<ThemedToken[][] | null> {
  const lang = resolveLanguage(language, filename);
  if (!lang) return null;
  highlighter ??= createHighlighterCore({
    themes: [import("shiki/themes/github-dark.mjs")],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  });
  const core = await highlighter;
  if (!core.getLoadedLanguages().includes(lang)) await core.loadLanguage(languages[lang]());
  return core.codeToTokensBase(code, { lang, theme: "github-dark" });
}

export type DiffRow = {
  type: "context" | "added" | "removed";
  oldNumber?: number;
  newNumber?: number;
  text: string;
};

export type DiffSegment = { type: "rows"; rows: DiffRow[] } | { type: "collapsed"; rows: DiffRow[] };

export function splitLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.length > 1 && lines.at(-1) === "") lines.pop();
  return lines;
}

export function diffRows(before: string, after: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldNumber = 1;
  let newNumber = 1;
  for (const change of diffLines(before, after)) {
    for (const text of splitLines(change.value)) {
      if (change.added) rows.push({ type: "added", newNumber: newNumber++, text });
      else if (change.removed) rows.push({ type: "removed", oldNumber: oldNumber++, text });
      else rows.push({ type: "context", oldNumber: oldNumber++, newNumber: newNumber++, text });
    }
  }
  return rows;
}

/** Collapses long unchanged runs, keeping a few lines of context around every change. */
export function collapseContext(rows: DiffRow[], keep = 3): DiffSegment[] {
  const segments: DiffSegment[] = [];
  let index = 0;
  while (index < rows.length) {
    if (rows[index]!.type !== "context") {
      const start = index;
      while (index < rows.length && rows[index]!.type !== "context") index += 1;
      segments.push({ type: "rows", rows: rows.slice(start, index) });
      continue;
    }
    const start = index;
    while (index < rows.length && rows[index]!.type === "context") index += 1;
    const run = rows.slice(start, index);
    const head = start === 0 ? 0 : keep;
    const tail = index === rows.length ? 0 : keep;
    if (run.length <= head + tail + 2) {
      segments.push({ type: "rows", rows: run });
      continue;
    }
    if (head) segments.push({ type: "rows", rows: run.slice(0, head) });
    segments.push({ type: "collapsed", rows: run.slice(head, run.length - tail) });
    if (tail) segments.push({ type: "rows", rows: run.slice(run.length - tail) });
  }
  return segments;
}

export type SplitRow = { left?: DiffRow; right?: DiffRow };

/** Pairs removed and added lines side by side for the split layout. */
export function pairRows(rows: DiffRow[]): SplitRow[] {
  const paired: SplitRow[] = [];
  let index = 0;
  while (index < rows.length) {
    const row = rows[index]!;
    if (row.type === "context") {
      paired.push({ left: row, right: row });
      index += 1;
      continue;
    }
    const removed: DiffRow[] = [];
    const added: DiffRow[] = [];
    while (rows[index]?.type === "removed") removed.push(rows[index++]!);
    while (rows[index]?.type === "added") added.push(rows[index++]!);
    for (let offset = 0; offset < Math.max(removed.length, added.length); offset += 1) {
      paired.push({ left: removed[offset], right: added[offset] });
    }
  }
  return paired;
}
