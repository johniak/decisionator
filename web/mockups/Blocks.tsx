import { Check, ImageOff, Maximize2, Minus, TrendingDown, TrendingUp, TriangleAlert, X } from "lucide-react";
import { useState } from "react";
import type { Mockup } from "../../src/domain/decision";
import { InlineMarkdown } from "../components/Markdown";
import { ZoomDialog } from "../components/ZoomDialog";

type Kind<K extends Mockup["kind"]> = Extract<Mockup, { kind: K }>;

export function TableBlock({ table }: { table: Kind<"table"> }) {
  return (
    <div className="table-scroll">
      <table className="data-table comparison-table">
        <thead>
          <tr>
            {table.columns.map((column, index) => (
              <th key={index} scope="col" className={index === table.highlightColumn ? "highlighted" : undefined}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, index) => {
                const Cell = index === 0 ? "th" : "td";
                return (
                  <Cell key={index} scope={index === 0 ? "row" : undefined} className={index === table.highlightColumn ? "highlighted" : undefined}>
                    <TableCell value={cell} />
                  </Cell>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TableCell({ value }: { value: string | number | boolean | null }) {
  if (value === true) return <span className="cell-yes"><Check aria-hidden="true" size={14} /><span className="sr-only">Yes</span></span>;
  if (value === false) return <span className="cell-no"><X aria-hidden="true" size={14} /><span className="sr-only">No</span></span>;
  if (value === null) return <span className="cell-empty"><Minus aria-hidden="true" size={14} /><span className="sr-only">Not applicable</span></span>;
  if (typeof value === "number") return <span className="cell-number">{new Intl.NumberFormat("en").format(value)}</span>;
  return <InlineMarkdown>{value}</InlineMarkdown>;
}

const toneIcons = {
  positive: TrendingUp,
  negative: TrendingDown,
  warning: TriangleAlert,
  neutral: null,
} as const;

export function StatsBlock({ stats }: { stats: Kind<"stats"> }) {
  return (
    <dl className="stats-block">
      {stats.items.map((item) => {
        const tone = item.tone ?? "neutral";
        const Icon = toneIcons[tone];
        return (
          <div key={item.label} className={`stat-tile stat-${tone}`}>
            <dt>{item.label}</dt>
            <dd>
              <strong>{typeof item.value === "number" ? new Intl.NumberFormat("en").format(item.value) : item.value}</strong>
              {item.detail && <span>{Icon && <Icon aria-hidden="true" size={12} />}{item.detail}</span>}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

export function PaletteBlock({ palette }: { palette: Kind<"palette"> }) {
  return (
    <ul className="palette-block">
      {palette.colors.map((color) => (
        <li key={`${color.name}-${color.value}`}>
          <span className="palette-swatch" style={{ background: color.value, color: readableInk(color.value) }}>Aa</span>
          <strong>{color.name}</strong>
          <code>{color.value}</code>
          {color.usage && <small>{color.usage}</small>}
        </li>
      ))}
    </ul>
  );
}

/** Picks dark or light sample text for a hex swatch; other colour notations keep the light sample. */
export function readableInk(value: string): string {
  const hex = value.match(/^#([0-9a-f]{3,8})$/i)?.[1];
  if (!hex) return "#ffffff";
  const full = hex.length <= 4 ? [...hex.slice(0, 3)].map((part) => part + part).join("") : hex.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16) / 255).map((channel) => (
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  const luminance = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  return luminance > 0.36 ? "#111318" : "#ffffff";
}

export function ImageBlock({ image, url }: { image: Kind<"image">; url?: string }) {
  const [zoomed, setZoomed] = useState(false);
  if (!url) {
    return <p className="image-missing"><ImageOff aria-hidden="true" size={14} /> {image.alt} is not available in this version.</p>;
  }
  return (
    <>
      <button type="button" className="image-mockup" aria-label={`Enlarge ${image.alt}`} onClick={() => setZoomed(true)}>
        <img src={url} alt={image.alt} style={image.width ? { width: image.width } : undefined} />
        <span className="diagram-zoom-hint"><Maximize2 aria-hidden="true" size={12} /> Enlarge</span>
      </button>
      <ZoomDialog open={zoomed} onOpenChange={setZoomed} title={image.alt}>
        <img className="zoomed-image" src={url} alt={image.alt} />
      </ZoomDialog>
    </>
  );
}
