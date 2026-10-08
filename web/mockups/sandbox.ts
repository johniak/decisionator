import DOMPurify from "dompurify";

export type MockupTheme = "light" | "dark";

/** Content Security Policy inside every HTML mockup: no scripts, no network, inline styles only. */
export const mockupContentSecurityPolicy = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'";

/** The iframe sandbox for HTML mockups. Scripts stay disabled; same-origin only lets the page measure the height. */
export const mockupSandbox = "allow-same-origin";

/** DOMPurify returns its input unchanged where it is unsupported, so refuse to render instead. */
function supportedPurifier() {
  const purifier = DOMPurify(window);
  if (!purifier.isSupported) throw new Error("This browser cannot sanitize agent-authored content safely.");
  return purifier;
}

const urlAttributes = new Set(["href", "src", "srcset", "xlink:href", "poster", "action", "formaction", "background", "ping"]);

/**
 * Removes scripts, event handlers, embeds, forms, and every non-inline URL from agent-authored HTML.
 * `FORCE_BODY` keeps `<style>` blocks that the agent placed in a `<head>`.
 */
export function sanitizeMockupHtml(html: string): string {
  const purifier = supportedPurifier();
  purifier.addHook("uponSanitizeAttribute", (_node, data) => {
    if (!urlAttributes.has(data.attrName)) return;
    const value = data.attrValue.trim();
    if (value.startsWith("#") || /^data:image\/(png|jpe?g|gif|webp);/i.test(value)) return;
    data.keepAttr = false;
  });
  return purifier.sanitize(html, {
    FORCE_BODY: true,
    ADD_TAGS: ["style"],
    FORBID_TAGS: ["script", "iframe", "frame", "frameset", "object", "embed", "form", "meta", "link", "base", "noscript", "template", "portal", "title"],
    FORBID_ATTR: ["target", "srcdoc"],
  }) as string;
}

/** Wraps a sanitized mockup in Decisionator's neutral design tokens for the chosen theme. */
export function buildMockupDocument(html: string, theme: MockupTheme): string {
  const body = sanitizeMockupHtml(html);
  return `<!doctype html>
<html lang="en" data-theme="${theme}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${mockupContentSecurityPolicy}">
<meta name="referrer" content="no-referrer">
<style>${neutralStyles}</style>
</head>
<body>${body}</body>
</html>`;
}

/** Sanitizes the SVG produced by Mermaid before it is inserted into the page. */
export function sanitizeDiagramSvg(svg: string): string {
  return supportedPurifier().sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ["style"],
    FORBID_TAGS: ["script", "foreignObject", "a"],
    FORBID_ATTR: ["href", "xlink:href"],
  }) as string;
}

export const neutralStyles = `
:root {
  color-scheme: light;
  --dn-bg: #f6f7f9; --dn-surface: #ffffff; --dn-surface-2: #eef0f4; --dn-border: #d8dce3;
  --dn-text: #1b1f27; --dn-muted: #646b78; --dn-accent: #127a8c; --dn-accent-soft: #dff3f3;
  --dn-accent-text: #ffffff; --dn-success: #1f8a57; --dn-warning: #b7791f; --dn-danger: #c2414b;
  --dn-radius: 10px; --dn-shadow: 0 1px 2px rgba(20, 24, 33, .08), 0 6px 18px rgba(20, 24, 33, .06);
  --dn-font: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --dn-bg: #0f1218; --dn-surface: #161b23; --dn-surface-2: #1d232d; --dn-border: #2b323e;
  --dn-text: #e7eaf0; --dn-muted: #98a0ae; --dn-accent: #3ddbc4; --dn-accent-soft: rgba(61, 219, 196, .14);
  --dn-accent-text: #062a2a; --dn-success: #56d39b; --dn-warning: #f2b84b; --dn-danger: #f37b83;
  --dn-shadow: 0 1px 2px rgba(0, 0, 0, .4), 0 8px 24px rgba(0, 0, 0, .3);
}
* { box-sizing: border-box; }
html, body { margin: 0; }
body { padding: 16px; background: var(--dn-bg); color: var(--dn-text); font: 14px/1.5 var(--dn-font); }
a { color: var(--dn-accent); pointer-events: none; }
h1, h2, h3, h4 { margin: 0 0 .5em; line-height: 1.25; }
p { margin: 0 0 .75em; }
img { max-width: 100%; }
.dn-row { display: flex; gap: 12px; align-items: center; }
.dn-col, .dn-stack { display: flex; flex-direction: column; gap: 12px; }
.dn-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
.dn-spacer { flex: 1; }
.dn-card { background: var(--dn-surface); border: 1px solid var(--dn-border); border-radius: var(--dn-radius); padding: 14px; box-shadow: var(--dn-shadow); }
.dn-muted { color: var(--dn-muted); }
.dn-small { font-size: 12px; }
.dn-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 34px; padding: 0 14px; border-radius: 8px; border: 1px solid var(--dn-border); background: var(--dn-surface); color: var(--dn-text); font: 600 13px var(--dn-font); }
.dn-btn-primary { background: var(--dn-accent); border-color: var(--dn-accent); color: var(--dn-accent-text); }
.dn-input { min-height: 36px; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--dn-border); background: var(--dn-surface); color: var(--dn-muted); }
.dn-badge { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px; background: var(--dn-accent-soft); color: var(--dn-accent); font-size: 11px; font-weight: 700; }
.dn-placeholder { min-height: 80px; border-radius: var(--dn-radius); border: 1px dashed var(--dn-border); background: repeating-linear-gradient(135deg, var(--dn-surface-2) 0 8px, transparent 8px 16px); display: grid; place-items: center; color: var(--dn-muted); font-size: 12px; }
.dn-nav { display: flex; gap: 16px; align-items: center; padding: 12px 16px; background: var(--dn-surface); border-bottom: 1px solid var(--dn-border); }
.dn-sidebar { width: 200px; padding: 12px; background: var(--dn-surface); border-right: 1px solid var(--dn-border); }
.dn-divider { height: 1px; background: var(--dn-border); margin: 12px 0; }
.dn-phone { width: 375px; max-width: 100%; margin: 0 auto; border: 10px solid #20242c; border-radius: 36px; overflow: hidden; background: var(--dn-bg); box-shadow: var(--dn-shadow); }
.dn-phone > .dn-screen { min-height: 480px; }
.dn-browser { border: 1px solid var(--dn-border); border-radius: 12px; overflow: hidden; background: var(--dn-bg); box-shadow: var(--dn-shadow); }
.dn-browser::before { content: ""; display: block; height: 28px; background: var(--dn-surface-2) radial-gradient(circle at 16px 14px, #f37b83 4px, transparent 5px), radial-gradient(circle at 32px 14px, #f2b84b 4px, transparent 5px), radial-gradient(circle at 48px 14px, #56d39b 4px, transparent 5px); background-repeat: no-repeat; border-bottom: 1px solid var(--dn-border); }
.dn-highlight { outline: 2px solid var(--dn-accent); outline-offset: 2px; }
`;
