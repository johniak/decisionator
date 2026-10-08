import { Maximize2, Moon, Sun } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ZoomDialog } from "../components/ZoomDialog";
import { buildMockupDocument, mockupSandbox, type MockupTheme } from "./sandbox";

const maxFrameHeight = 1_600;

export function HtmlMockup({ body, theme: initialTheme = "dark", title }: { body: string; theme?: MockupTheme; title: string }) {
  const [theme, setTheme] = useState<MockupTheme>(initialTheme);
  const [zoomed, setZoomed] = useState(false);
  const srcDoc = useMemo(() => buildMockupDocument(body, theme), [body, theme]);

  return (
    <div className="html-mockup">
      <div className="mockup-toolbar">
        <div className="segmented" role="group" aria-label="Mockup theme">
          <button type="button" aria-pressed={theme === "light"} onClick={() => setTheme("light")}>
            <Sun aria-hidden="true" size={13} /> Light
          </button>
          <button type="button" aria-pressed={theme === "dark"} onClick={() => setTheme("dark")}>
            <Moon aria-hidden="true" size={13} /> Dark
          </button>
        </div>
        <button type="button" className="mockup-tool-button" onClick={() => setZoomed(true)}>
          <Maximize2 aria-hidden="true" size={13} /> Enlarge
        </button>
      </div>
      <div className="html-mockup-frame">
        <MockupFrame srcDoc={srcDoc} title={title} />
        <button type="button" className="mockup-overlay" aria-label={`Enlarge ${title}`} onClick={() => setZoomed(true)} />
      </div>
      <ZoomDialog open={zoomed} onOpenChange={setZoomed} title={title}>
        <div className="html-mockup-frame zoomed">
          <MockupFrame srcDoc={srcDoc} title={`${title} (enlarged)`} />
        </div>
      </ZoomDialog>
    </div>
  );
}

export function MockupFrame({ srcDoc, title }: { srcDoc: string; title: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(220);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let observer: ResizeObserver | undefined;
    const measure = () => {
      const body = frame.contentDocument?.body;
      if (!body) return;
      const style = frame.contentWindow?.getComputedStyle(body);
      const margins = style ? parseFloat(style.marginTop) + parseFloat(style.marginBottom) : 0;
      const content = Math.ceil(body.getBoundingClientRect().height + (Number.isFinite(margins) ? margins : 0));
      if (content > 0) setHeight(Math.min(maxFrameHeight, Math.max(60, content)));
    };
    const attach = () => {
      measure();
      observer?.disconnect();
      const body = frame.contentDocument?.body;
      if (body && typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(measure);
        observer.observe(body);
      }
    };
    frame.addEventListener("load", attach);
    if (frame.contentDocument?.readyState === "complete") attach();
    return () => {
      frame.removeEventListener("load", attach);
      observer?.disconnect();
    };
  }, [srcDoc]);

  return (
    <iframe
      ref={frameRef}
      title={title}
      sandbox={mockupSandbox}
      srcDoc={srcDoc}
      referrerPolicy="no-referrer"
      loading="eager"
      style={{ height }}
    />
  );
}
