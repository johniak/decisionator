# Mockups and visuals

Every group and every option can carry one `mockup`. Prefer the structured kinds: they need only JSON, look consistent, and work in Decisionator's dark interface. Use `html` only for layouts and wireframes. Every kind accepts an optional one-line `caption`.

## Choosing a kind

| The human needs to compare… | Use |
| --- | --- |
| Capabilities, costs, or criteria across options | `table` |
| Numbers over time or between options | `chart` |
| A flow, sequence, state machine, data model, or timeline | `mermaid` |
| Two or three key figures | `stats` |
| Colours | `palette` |
| An API shape or a code snippet | `code` |
| A code change | `diff` |
| An existing screen | `image` |
| Two things side by side | `split` |
| A layout, wireframe, or new screen | `html` |

## table

```json
{ "kind": "table", "columns": ["Capability", "Stripe", "Adyen"], "rows": [["BLIK", true, true], ["Monthly fee", "none", "€120"], ["Setup days", 4, 8]], "highlightColumn": 1 }
```

Column headers may be empty, for example above a column of row labels. Cells are strings (inline Markdown), numbers, `true` (✓), `false` (✗), or `null` (not applicable). Every row has one cell per column. `highlightColumn` (zero-based) marks the recommended column.

## chart

```json
{ "kind": "chart", "type": "bar", "x": "month", "unit": "€", "xLabel": "Month", "yLabel": "Cost",
  "series": [{ "key": "current", "label": "Current" }, { "key": "proposed", "label": "Proposed" }],
  "data": [{ "month": "Jan", "current": 1200, "proposed": 900 }, { "month": "Feb", "current": 1300, "proposed": 950 }] }
```

- `type` is `bar`, `line`, `area`, `pie`, `scatter`, or `radar`.
- `x` names the category key in each data row; every `series[].key` names a numeric (or `null`) value.
- `stacked: true` stacks bars or areas. A `pie` chart has exactly one series and uses `x` as slice names. A `scatter` chart needs a numeric `x`. A `radar` chart uses `x` as its axes and one series per option.
- `unit` is a short suffix or prefix such as `%`, `ms`, or `€`. Keep series to eight or fewer; scatter charts read best with three.
- The human can switch every chart to a data table.

## mermaid

```json
{ "kind": "mermaid", "code": "sequenceDiagram\n  Client->>API: POST /orders\n  API-->>Client: 201 Created" }
```

Any Mermaid diagram works: `flowchart`, `sequenceDiagram`, `stateDiagram-v2`, `erDiagram`, `classDiagram`, `gantt`, `timeline`, `mindmap`, `quadrantChart`, `journey`, and more. Decisionator renders it with Mermaid's strict security level: click handlers, links, and HTML labels are removed, and the output is sanitized. Keep labels short; use `\n` for new lines in JSON.

## stats

```json
{ "kind": "stats", "items": [{ "label": "Bundle size", "value": "+12 kB", "detail": "gzip", "tone": "negative" }, { "label": "p95 latency", "value": "180 ms", "tone": "positive" }] }
```

Up to eight tiles. `tone` is `neutral`, `positive`, `negative`, or `warning` and colours only the detail line, which also carries an icon.

## palette

```json
{ "kind": "palette", "colors": [{ "name": "Primary", "value": "#127a8c", "usage": "Buttons and links" }, { "name": "Surface", "value": "oklch(0.97 0.01 250)" }] }
```

Values are hex, `rgb()`, `hsl()`, `oklch()`, `oklab()`, `lab()`, or `lch()` colours.

## code and diff

```json
{ "kind": "code", "language": "ts", "filename": "api.ts", "code": "export type Result = { ok: true } | { ok: false; error: string };" }
```

```json
{ "kind": "diff", "language": "ts", "filename": "src/api.ts", "before": "const limit = 10;\n", "after": "const limit = 50;\n", "layout": "split" }
```

Highlighted languages include TypeScript, TSX, JavaScript, JSX, JSON, YAML, TOML, shell, Python, Go, Rust, Java, Kotlin, Swift, C, C#, SQL, HTML, CSS, SCSS, GraphQL, Dockerfile, XML, and diff. Other languages are shown as plain text. A diff opens in `unified` or `split` layout; the human can switch, and long unchanged runs collapse.

## image

```json
{ "kind": "image", "path": "/Users/me/project/.screenshots/checkout-phone.png", "alt": "Checkout on a 390 px phone", "width": 280 }
```

- `path` must be absolute. The file must be a PNG, JPEG, GIF, WebP, or SVG image of at most 15 MB.
- Decisionator reads the file once when the document arrives and serves only that snapshot. Overwriting the file later does not change what the human sees, so take a new screenshot and send a new document version to show a change.
- `width` sets the display width in pixels. The human can click any image to enlarge it.
- For a review, capture phone and desktop widths, and light and dark themes when the product supports them, then pair them with `split`.

## split

```json
{ "kind": "split", "leftLabel": "Before", "rightLabel": "After",
  "left": { "kind": "image", "path": "/tmp/before.png", "alt": "Before" },
  "right": { "kind": "html", "body": "<div class=\"dn-card\">After</div>" } }
```

`left` and `right` can be any kind except another `split`. The two sides are shown next to each other and stack when the space is narrow.

## html

```json
{ "kind": "html", "theme": "light", "body": "<div class=\"dn-browser\"><div class=\"dn-nav\"><strong>Shop</strong><span class=\"dn-spacer\"></span><button class=\"dn-btn dn-btn-primary\">Checkout</button></div><div style=\"padding:16px\" class=\"dn-grid\"><div class=\"dn-card\">Product</div><div class=\"dn-placeholder\">Image</div></div></div>" }
```

HTML mockups are static pictures, not prototypes:

- They render in a sandboxed frame without scripts, with a Content Security Policy that blocks every network request. Scripts, event handlers, frames, forms, embeds, `<meta>`, `<link>`, `<base>`, and any URL that is not `#…` or an inline `data:image/…` are removed. Inline `<style>` blocks and `style` attributes are kept.
- The frame is sized to its content (up to 1,600 px). The human can switch between light and dark and enlarge the mockup; `theme` picks the initial theme.
- Use the neutral design tokens so the mockup follows the selected theme: `--dn-bg`, `--dn-surface`, `--dn-surface-2`, `--dn-border`, `--dn-text`, `--dn-muted`, `--dn-accent`, `--dn-accent-soft`, `--dn-accent-text`, `--dn-success`, `--dn-warning`, `--dn-danger`, `--dn-radius`, `--dn-shadow`, and `--dn-font`.

Helper classes:

| Class | Renders |
| --- | --- |
| `dn-browser` | A desktop browser window frame |
| `dn-phone` with a `dn-screen` child | A phone frame |
| `dn-nav`, `dn-sidebar` | A top bar and a side bar |
| `dn-row`, `dn-col`, `dn-stack`, `dn-grid`, `dn-spacer` | Flex rows, columns, auto-fit grids, and a flexible gap |
| `dn-card` | A surface with border and shadow |
| `dn-btn`, `dn-btn-primary` | Buttons |
| `dn-input` | A form field |
| `dn-badge` | A small accent label |
| `dn-placeholder` | A hatched box for images or content you are not drawing |
| `dn-muted`, `dn-small`, `dn-divider`, `dn-highlight` | Secondary text, small text, a divider, and an accent outline for the part under discussion |
