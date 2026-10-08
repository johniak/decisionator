// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  buildMockupDocument,
  mockupContentSecurityPolicy,
  mockupSandbox,
  sanitizeDiagramSvg,
  sanitizeMockupHtml,
} from "../../web/mockups/sandbox";

// happy-dom does not enforce iframe sandboxes or CSP. These tests pin the policy Decisionator
// emits; the enforcement itself was verified against hostile documents in Chrome (see SECURITY.md).

describe("HTML mockup sandbox", () => {
  it("never allows scripts in the mockup frame", () => {
    expect(mockupSandbox).toBe("allow-same-origin");
    expect(mockupSandbox).not.toContain("allow-scripts");
  });

  it("removes scripts, handlers, frames, forms, embeds, and document-level tags", () => {
    const clean = sanitizeMockupHtml(`
      <script>alert(1)</script>
      <img src="x" onerror="alert(1)">
      <div onclick="alert(1)">Card</div>
      <iframe src="https://example.com"></iframe>
      <form action="https://example.com"><input name="q"><button>Go</button></form>
      <object data="https://example.com/x"></object><embed src="https://example.com/y">
      <meta http-equiv="refresh" content="0;url=https://example.com">
      <link rel="stylesheet" href="https://example.com/a.css"><base href="https://example.com/">
      <template><p>hidden</p></template>
    `);

    for (const forbidden of ["<script", "onerror", "onclick", "<iframe", "<form", "<object", "<embed", "<meta", "<link", "<base", "<template"]) {
      expect(clean).not.toContain(forbidden);
    }
    expect(clean).toContain("<div>Card</div>");
    expect(clean).toContain("<button>Go</button>");
  });

  it("drops every URL that would leave the machine and keeps inline images", () => {
    const clean = sanitizeMockupHtml(`
      <a href="https://example.com" target="_top">External</a>
      <a href="#step-2">Anchor</a>
      <a href="javascript:alert(1)">Script link</a>
      <img src="https://example.com/a.png" srcset="https://example.com/b.png 2x">
      <img src="data:image/png;base64,iVBORw0KGgo=">
      <img src="data:text/html;base64,PHNjcmlwdD4=">
      <video poster="https://example.com/p.png"></video>
    `);

    expect(clean).not.toContain("example.com");
    expect(clean).not.toContain("javascript:");
    expect(clean).not.toContain("data:text/html");
    expect(clean).not.toContain("target=");
    expect(clean).toContain('href="#step-2"');
    expect(clean).toContain('src="data:image/png;base64,iVBORw0KGgo="');
  });

  it("keeps styles, including ones the agent placed in a head", () => {
    const clean = sanitizeMockupHtml("<html><head><style>.hero { color: red; }</style></head><body><div class=\"hero\" style=\"padding: 4px\">Hi</div></body></html>");

    expect(clean).toContain("<style>.hero { color: red; }</style>");
    expect(clean).toContain('style="padding: 4px"');
  });

  it("builds a document whose first head element is a no-network policy", () => {
    const document = buildMockupDocument("<p>Hello</p>", "light");
    const head = document.slice(document.indexOf("<head>"), document.indexOf("</head>"));

    expect(head.indexOf("<meta charset=\"utf-8\">")).toBeLessThan(head.indexOf("Content-Security-Policy"));
    expect(head.indexOf("Content-Security-Policy")).toBeLessThan(head.indexOf("<style>"));
    expect(document).toContain(`content="${mockupContentSecurityPolicy}"`);
    expect(mockupContentSecurityPolicy).toContain("default-src 'none'");
    expect(mockupContentSecurityPolicy).toContain("img-src data:");
    expect(mockupContentSecurityPolicy).not.toMatch(/script-src|https?:/);
    expect(document).toContain('<html lang="en" data-theme="light">');
    expect(document).toContain("<body><p>Hello</p></body>");
    expect(buildMockupDocument("<p>Hello</p>", "dark")).toContain('data-theme="dark"');
  });

  it("ships neutral tokens for both themes", () => {
    const document = buildMockupDocument("<p>Hi</p>", "dark");

    expect(document).toContain(':root[data-theme="dark"]');
    for (const token of ["--dn-bg", "--dn-surface", "--dn-text", "--dn-accent"]) expect(document).toContain(token);
    for (const helper of [".dn-browser", ".dn-phone", ".dn-card", ".dn-btn-primary", ".dn-placeholder"]) expect(document).toContain(helper);
  });
});

describe("diagram sanitizing", () => {
  it("removes links, scripts, handlers, and HTML labels from Mermaid output", () => {
    const clean = sanitizeDiagramSvg(`<svg xmlns="http://www.w3.org/2000/svg">
      <style>.node rect { fill: #123; }</style>
      <script>alert(1)</script>
      <a href="javascript:alert(1)"><text>Click</text></a>
      <g class="node" onclick="alert(1)"><rect width="10" height="10"/></g>
      <foreignObject><div>html label</div></foreignObject>
      <image href="https://example.com/x.png"/>
    </svg>`);

    expect(clean).toContain("<svg");
    expect(clean).toContain(".node rect");
    for (const forbidden of ["<script", "<a", "javascript:", "onclick", "foreignObject", "example.com"]) {
      expect(clean).not.toContain(forbidden);
    }
  });
});
