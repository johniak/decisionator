import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const components: Components = {
  a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>,
  // Remote images would leave the machine; agents use image mockups for screenshots instead.
  img: ({ alt }) => <span className="markdown-image-placeholder">{alt ? `Image: ${alt}` : "Image"}</span>,
};

const inlineComponents: Components = {
  ...components,
  p: ({ children }) => <>{children}</>,
};

export function Markdown({ children, className = "markdown", lang }: { children: string; className?: string; lang?: string }) {
  return (
    <div className={className} lang={lang}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{children}</ReactMarkdown>
    </div>
  );
}

export function InlineMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={inlineComponents}
      allowedElements={["p", "strong", "em", "code", "a", "del", "br", "img"]}
      unwrapDisallowed
    >
      {children}
    </ReactMarkdown>
  );
}
