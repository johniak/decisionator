import { TriangleAlert } from "lucide-react";
import { Component, type ReactNode } from "react";
import type { LeafMockup, Mockup } from "../../src/domain/decision";
import { ImageBlock, PaletteBlock, StatsBlock, TableBlock } from "./Blocks";
import { CodeBlock, DiffBlock } from "./CodeBlocks";
import { ChartBlock } from "./ChartBlock";
import { HtmlMockup } from "./HtmlMockup";
import { MermaidDiagram } from "./MermaidDiagram";

export type AssetResolver = (path: string) => string | undefined;

/** Keeps one broken visual from taking down the whole decision screen. */
class MockupBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return <p className="mockup-failed" role="alert"><TriangleAlert aria-hidden="true" size={14} /> This visual could not be shown.</p>;
    }
    return this.props.children;
  }
}

export function MockupView(props: { mockup: Mockup; title: string; resolveAsset: AssetResolver }) {
  return <MockupBoundary><MockupFigure {...props} /></MockupBoundary>;
}

function MockupFigure({ mockup, title, resolveAsset }: { mockup: Mockup; title: string; resolveAsset: AssetResolver }) {
  return (
    <figure className={`mockup mockup-${mockup.kind}`}>
      {mockup.kind === "split" ? (
        <div className="split-mockup">
          <div className="split-side">
            {mockup.leftLabel && <span className="split-label">{mockup.leftLabel}</span>}
            <LeafMockupView mockup={mockup.left} title={`${title}: ${mockup.leftLabel ?? "left"}`} resolveAsset={resolveAsset} />
          </div>
          <div className="split-side">
            {mockup.rightLabel && <span className="split-label">{mockup.rightLabel}</span>}
            <LeafMockupView mockup={mockup.right} title={`${title}: ${mockup.rightLabel ?? "right"}`} resolveAsset={resolveAsset} />
          </div>
        </div>
      ) : <LeafMockupView mockup={mockup} title={title} resolveAsset={resolveAsset} />}
      {mockup.caption && <figcaption>{mockup.caption}</figcaption>}
    </figure>
  );
}

function LeafMockupView({ mockup, title, resolveAsset }: { mockup: LeafMockup; title: string; resolveAsset: AssetResolver }) {
  switch (mockup.kind) {
    case "html": return <HtmlMockup body={mockup.body} theme={mockup.theme} title={title} />;
    case "image": return <ImageBlock image={mockup} url={resolveAsset(mockup.path)} />;
    case "mermaid": return <MermaidDiagram code={mockup.code} title={title} />;
    case "chart": return <ChartBlock chart={mockup} />;
    case "table": return <TableBlock table={mockup} />;
    case "stats": return <StatsBlock stats={mockup} />;
    case "palette": return <PaletteBlock palette={mockup} />;
    case "code": return <CodeBlock code={mockup} />;
    case "diff": return <DiffBlock diff={mockup} />;
  }
}
