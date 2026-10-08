import { LoaderCircle, Maximize2, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { ZoomDialog } from "../components/ZoomDialog";
import { sanitizeDiagramSvg } from "./sandbox";

let renderCount = 0;
let mermaidLoader: Promise<typeof import("mermaid")["default"]> | undefined;

async function loadMermaid() {
  mermaidLoader ??= import("mermaid").then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      htmlLabels: false,
      flowchart: { htmlLabels: false, curve: "basis" },
      fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      themeVariables: {
        darkMode: true,
        background: "#131820",
        primaryColor: "#1b2a30",
        primaryBorderColor: "#3ddbc4",
        primaryTextColor: "#e7eaf0",
        secondaryColor: "#1d222c",
        secondaryBorderColor: "#3a4252",
        tertiaryColor: "#171c24",
        tertiaryBorderColor: "#2b323e",
        lineColor: "#7f8898",
        textColor: "#d5d9e1",
        mainBkg: "#1b2a30",
        nodeBorder: "#3ddbc4",
        clusterBkg: "#151a22",
        clusterBorder: "#2b323e",
        edgeLabelBackground: "#131820",
        noteBkgColor: "#2a2618",
        noteBorderColor: "#ffc145",
        noteTextColor: "#f3ead1",
        actorBkg: "#1b2a30",
        actorBorder: "#3ddbc4",
        actorTextColor: "#e7eaf0",
        signalColor: "#c3c9d4",
        signalTextColor: "#e7eaf0",
      },
    });
    return mermaid;
  });
  return mermaidLoader;
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Renders Mermaid text to sanitized SVG. Mermaid runs with its strict security level and no HTML
 * labels, and renders one diagram at a time because concurrent renders interfere with each other.
 */
export function renderDiagram(code: string): Promise<string> {
  const result = queue.then(async () => {
    const mermaid = await loadMermaid();
    renderCount += 1;
    const id = `decisionator-diagram-${renderCount}`;
    try {
      const { svg } = await mermaid.render(id, code);
      const clean = sanitizeDiagramSvg(svg);
      if (!clean.includes("<svg")) throw new Error("The diagram produced no drawable output.");
      return clean;
    } finally {
      document.getElementById(`d${id}`)?.remove();
      document.getElementById(id)?.remove();
    }
  });
  queue = result.catch(() => undefined);
  return result;
}

export function MermaidDiagram({ code, title }: { code: string; title: string }) {
  const [state, setState] = useState<{ svg?: string; error?: string }>({});
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState({});
    renderDiagram(code)
      .then((svg) => { if (!cancelled) setState({ svg }); })
      .catch((error: unknown) => {
        if (!cancelled) setState({ error: error instanceof Error ? error.message : "The diagram could not be rendered." });
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (state.error) {
    return (
      <div className="diagram-error" role="alert">
        <p><TriangleAlert aria-hidden="true" size={14} /> This diagram could not be rendered.</p>
        <small>{state.error}</small>
        <pre>{code}</pre>
      </div>
    );
  }
  if (!state.svg) {
    return <div className="diagram-loading"><LoaderCircle className="spin" aria-hidden="true" size={16} /> Drawing diagram…</div>;
  }
  return (
    <>
      <button type="button" className="diagram" aria-label={`Enlarge ${title}`} onClick={() => setZoomed(true)}>
        <span className="diagram-svg" dangerouslySetInnerHTML={{ __html: state.svg }} />
        <span className="diagram-zoom-hint"><Maximize2 aria-hidden="true" size={12} /> Enlarge</span>
      </button>
      <ZoomDialog open={zoomed} onOpenChange={setZoomed} title={title}>
        <div className="diagram-svg zoomed" dangerouslySetInnerHTML={{ __html: state.svg }} />
      </ZoomDialog>
    </>
  );
}
