import clsx from "clsx";
import { ChevronsUpDown, Columns2, Rows3 } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import type { ThemedToken } from "shiki/core";
import type { Mockup } from "../../src/domain/decision";
import { collapseContext, diffRows, highlightLines, pairRows, splitLines, type DiffRow } from "./highlight";

type Kind<K extends Mockup["kind"]> = Extract<Mockup, { kind: K }>;

function useHighlightedLines(code: string, language?: string, filename?: string) {
  const [tokens, setTokens] = useState<ThemedToken[][] | null>(null);
  useEffect(() => {
    let cancelled = false;
    setTokens(null);
    highlightLines(code, language, filename)
      .then((lines) => { if (!cancelled) setTokens(lines); })
      .catch(() => { if (!cancelled) setTokens(null); });
    return () => {
      cancelled = true;
    };
  }, [code, language, filename]);
  return tokens;
}

function LineContent({ text, tokens }: { text: string; tokens?: ThemedToken[] }) {
  if (!tokens) return <>{text || " "}</>;
  if (tokens.length === 0) return <> </>;
  return <>{tokens.map((token, index) => <span key={index} style={{ color: token.color }}>{token.content}</span>)}</>;
}

function CodeHeader({ filename, language }: { filename?: string; language?: string }) {
  if (!filename && !language) return null;
  return (
    <div className="code-header">
      {filename && <strong>{filename}</strong>}
      {language && <span>{language}</span>}
    </div>
  );
}

export function CodeBlock({ code }: { code: Kind<"code"> }) {
  const lines = useMemo(() => splitLines(code.code), [code.code]);
  const tokens = useHighlightedLines(code.code, code.language, code.filename);
  return (
    <div className="code-block">
      <CodeHeader filename={code.filename} language={code.language} />
      <div className="code-scroll">
        <table className="code-table">
          <tbody>
            {lines.map((line, index) => (
              <tr key={index}>
                <td className="line-number">{index + 1}</td>
                <td className="line-code"><LineContent text={line} tokens={tokens?.[index]} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function DiffBlock({ diff }: { diff: Kind<"diff"> }) {
  const [layout, setLayout] = useState<"unified" | "split">(diff.layout ?? "unified");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const rows = useMemo(() => diffRows(diff.before, diff.after), [diff.before, diff.after]);
  const segments = useMemo(() => collapseContext(rows), [rows]);
  const beforeTokens = useHighlightedLines(diff.before, diff.language, diff.filename);
  const afterTokens = useHighlightedLines(diff.after, diff.language, diff.filename);
  const tokensFor = (row: DiffRow) => row.type === "removed"
    ? beforeTokens?.[row.oldNumber! - 1]
    : afterTokens?.[row.newNumber! - 1];
  const added = rows.filter((row) => row.type === "added").length;
  const removed = rows.filter((row) => row.type === "removed").length;

  return (
    <div className="code-block diff-block">
      <div className="code-header">
        {diff.filename && <strong>{diff.filename}</strong>}
        <span className="diff-stat"><b>+{added}</b><i>−{removed}</i></span>
        <div className="segmented" role="group" aria-label="Diff layout">
          <button type="button" aria-pressed={layout === "unified"} onClick={() => setLayout("unified")}>
            <Rows3 aria-hidden="true" size={13} /> Unified
          </button>
          <button type="button" aria-pressed={layout === "split"} onClick={() => setLayout("split")}>
            <Columns2 aria-hidden="true" size={13} /> Split
          </button>
        </div>
      </div>
      <div className="code-scroll">
        <table className={clsx("code-table", layout === "split" && "split")}>
          <tbody>
            {segments.map((segment, index) => {
              if (segment.type === "collapsed" && !expanded.has(index)) {
                return (
                  <tr key={index} className="collapsed-row">
                    <td colSpan={layout === "split" ? 4 : 3}>
                      <button type="button" onClick={() => setExpanded((current) => new Set(current).add(index))}>
                        <ChevronsUpDown aria-hidden="true" size={12} /> Show {segment.rows.length} unchanged lines
                      </button>
                    </td>
                  </tr>
                );
              }
              if (layout === "unified") {
                return (
                  <Fragment key={index}>
                    {segment.rows.map((row, rowIndex) => (
                      <tr key={rowIndex} className={`diff-${row.type}`}>
                        <td className="line-number">{row.oldNumber ?? ""}</td>
                        <td className="line-number">{row.newNumber ?? ""}</td>
                        <td className="line-code">
                          <span className="diff-marker" aria-hidden="true">{row.type === "added" ? "+" : row.type === "removed" ? "−" : " "}</span>
                          <span className="sr-only">{row.type === "added" ? "Added: " : row.type === "removed" ? "Removed: " : ""}</span>
                          <LineContent text={row.text} tokens={tokensFor(row)} />
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                );
              }
              return (
                <Fragment key={index}>
                  {pairRows(segment.rows).map((pair, rowIndex) => (
                    <tr key={rowIndex}>
                      <td className={clsx("line-number", pair.left && `diff-${pair.left.type}`)}>{pair.left?.oldNumber ?? ""}</td>
                      <td className={clsx("line-code", pair.left ? `diff-${pair.left.type}` : "diff-empty")}>
                        {pair.left && <LineContent text={pair.left.text} tokens={tokensFor(pair.left)} />}
                      </td>
                      <td className={clsx("line-number", pair.right && `diff-${pair.right.type}`)}>{pair.right?.newNumber ?? ""}</td>
                      <td className={clsx("line-code", pair.right ? `diff-${pair.right.type}` : "diff-empty")}>
                        {pair.right && <LineContent text={pair.right.text} tokens={tokensFor(pair.right)} />}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
