import { BarChart3, Table2 } from "lucide-react";
import { useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Label,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Mockup } from "../../src/domain/decision";

type Chart = Extract<Mockup, { kind: "chart" }>;
type Row = Chart["data"][number];

/** Categorical slots validated for colour-vision deficiency against the dark card surface (#131820). */
export const seriesColors = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
const surface = "#131820";
const grid = "#262c37";
const axis = "#8b93a3";
const maxPieSlices = 8;

export function ChartBlock({ chart }: { chart: Chart }) {
  const [showTable, setShowTable] = useState(false);
  const legend = legendItems(chart);

  return (
    <div className="chart-block">
      <div className="chart-toolbar">
        {legend.length > 1 ? (
          <ul className="chart-legend" aria-label="Legend">
            {legend.map((item) => (
              <li key={item.label}><span style={{ background: item.color }} aria-hidden="true" />{item.label}</li>
            ))}
          </ul>
        ) : <span />}
        <button type="button" className="mockup-tool-button" aria-pressed={showTable} onClick={() => setShowTable((value) => !value)}>
          {showTable ? <BarChart3 aria-hidden="true" size={13} /> : <Table2 aria-hidden="true" size={13} />}
          {showTable ? "Show chart" : "Show data"}
        </button>
      </div>
      {showTable ? <ChartTable chart={chart} /> : (
        <div className="chart-canvas" role="img" aria-label={chartDescription(chart)}>
          <ResponsiveContainer width="100%" height={chart.type === "pie" || chart.type === "radar" ? 300 : 280} initialDimension={{ width: 640, height: 280 }}>
            {renderChart(chart)}
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function legendItems(chart: Chart) {
  if (chart.type === "pie") {
    return pieData(chart).map((row, index) => ({ label: String(row.name), color: seriesColors[index]! }));
  }
  return chart.series.map((series, index) => ({ label: series.label ?? series.key, color: seriesColors[index]! }));
}

function chartDescription(chart: Chart): string {
  const series = chart.series.map((item) => item.label ?? item.key).join(", ");
  return `${chart.type} chart of ${series} by ${chart.xLabel ?? chart.x}. Use "Show data" for the values.`;
}

const prefixUnits = new Set(["$", "€", "£", "¥", "₹"]);

export function formatValue(value: unknown, unit?: string, compact = false): string {
  if (typeof value !== "number") return value === null || value === undefined ? "—" : String(value);
  const formatted = new Intl.NumberFormat("en", compact
    ? { notation: "compact", maximumFractionDigits: 1 }
    : { maximumFractionDigits: 2 }).format(value);
  if (!unit) return formatted;
  if (unit === "%") return `${formatted}%`;
  if (prefixUnits.has(unit)) return `${unit}${formatted}`;
  return `${formatted} ${unit}`;
}

function ChartTooltip({ active, payload, label, unit }: {
  active?: boolean;
  payload?: { name?: string; value?: unknown; color?: string; payload?: Row }[];
  label?: unknown;
  unit?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      {label !== undefined && label !== "" && <strong>{String(label)}</strong>}
      {payload.map((item, index) => (
        <span key={`${item.name}-${index}`}>
          <i style={{ background: item.color }} aria-hidden="true" />
          {item.name}
          <b>{formatValue(item.value, unit)}</b>
        </span>
      ))}
    </div>
  );
}

function renderChart(chart: Chart) {
  const tooltip = <Tooltip cursor={{ stroke: "#3a4252", fill: "rgba(255,255,255,.04)" }} content={<ChartTooltip unit={chart.unit} />} />;
  const axes = (
    <>
      <CartesianGrid stroke={grid} vertical={false} />
      <XAxis dataKey={chart.x} stroke={grid} tick={{ fill: axis, fontSize: 11 }} tickLine={false}>
        {chart.xLabel && <Label value={chart.xLabel} position="insideBottom" offset={-4} fill={axis} fontSize={11} />}
      </XAxis>
      <YAxis stroke={grid} tick={{ fill: axis, fontSize: 11 }} tickLine={false} axisLine={false} width={56}
        tickFormatter={(value: number) => formatValue(value, chart.unit, true)}>
        {chart.yLabel && <Label value={chart.yLabel} angle={-90} position="insideLeft" fill={axis} fontSize={11} />}
      </YAxis>
    </>
  );
  const margin = { top: 8, right: 16, bottom: chart.xLabel ? 16 : 4, left: 4 };
  const name = (index: number) => chart.series[index]!.label ?? chart.series[index]!.key;

  switch (chart.type) {
    case "bar":
      return (
        <BarChart data={chart.data} margin={margin} barGap={2}>
          {axes}
          {tooltip}
          {chart.series.map((series, index) => (
            <Bar key={series.key} dataKey={series.key} name={name(index)} fill={seriesColors[index]} maxBarSize={24}
              stackId={chart.stacked ? "stack" : undefined}
              radius={!chart.stacked || index === chart.series.length - 1 ? [4, 4, 0, 0] : 0}
              stroke={chart.stacked ? surface : undefined} strokeWidth={chart.stacked ? 2 : 0} isAnimationActive={false} />
          ))}
        </BarChart>
      );
    case "line":
      return (
        <LineChart data={chart.data} margin={margin}>
          {axes}
          {tooltip}
          {chart.series.map((series, index) => (
            <Line key={series.key} dataKey={series.key} name={name(index)} stroke={seriesColors[index]} strokeWidth={2}
              type="monotone" dot={{ r: 4, fill: seriesColors[index], stroke: surface, strokeWidth: 2 }} connectNulls
              isAnimationActive={false} />
          ))}
        </LineChart>
      );
    case "area":
      return (
        <AreaChart data={chart.data} margin={margin}>
          {axes}
          {tooltip}
          {chart.series.map((series, index) => (
            <Area key={series.key} dataKey={series.key} name={name(index)} stroke={seriesColors[index]} strokeWidth={2}
              fill={seriesColors[index]} fillOpacity={0.1} type="monotone" stackId={chart.stacked ? "stack" : undefined}
              isAnimationActive={false} />
          ))}
        </AreaChart>
      );
    case "scatter":
      return (
        <ScatterChart margin={margin}>
          <CartesianGrid stroke={grid} />
          <XAxis type="number" dataKey="x" name={chart.xLabel ?? chart.x} stroke={grid} tick={{ fill: axis, fontSize: 11 }} tickLine={false}>
            {chart.xLabel && <Label value={chart.xLabel} position="insideBottom" offset={-4} fill={axis} fontSize={11} />}
          </XAxis>
          <YAxis type="number" dataKey="y" stroke={grid} tick={{ fill: axis, fontSize: 11 }} tickLine={false} axisLine={false} width={56}
            tickFormatter={(value: number) => formatValue(value, chart.unit, true)}>
            {chart.yLabel && <Label value={chart.yLabel} angle={-90} position="insideLeft" fill={axis} fontSize={11} />}
          </YAxis>
          <Tooltip cursor={{ stroke: "#3a4252" }} content={<ChartTooltip unit={chart.unit} />} />
          {chart.series.map((series, index) => (
            <Scatter key={series.key} name={name(index)} fill={seriesColors[index]} stroke={surface} strokeWidth={2}
              data={chart.data.filter((row) => typeof row[series.key] === "number").map((row) => ({ x: row[chart.x], y: row[series.key] }))}
              isAnimationActive={false} />
          ))}
        </ScatterChart>
      );
    case "pie":
      return (
        <PieChart>
          <Tooltip content={<ChartTooltip unit={chart.unit} />} />
          <Pie data={pieData(chart)} dataKey="value" nameKey="name" innerRadius={62} outerRadius={110} paddingAngle={1}
            stroke={surface} strokeWidth={2} isAnimationActive={false}>
            {pieData(chart).map((row, index) => <Cell key={String(row.name)} fill={seriesColors[index]} />)}
          </Pie>
        </PieChart>
      );
    case "radar":
      return (
        <RadarChart data={chart.data} outerRadius="72%">
          <PolarGrid stroke={grid} />
          <PolarAngleAxis dataKey={chart.x} tick={{ fill: axis, fontSize: 11 }} />
          <PolarRadiusAxis stroke={grid} tick={{ fill: axis, fontSize: 10 }} axisLine={false} />
          <Tooltip content={<ChartTooltip unit={chart.unit} />} />
          {chart.series.map((series, index) => (
            <Radar key={series.key} dataKey={series.key} name={name(index)} stroke={seriesColors[index]} strokeWidth={2}
              fill={seriesColors[index]} fillOpacity={0.1} isAnimationActive={false} />
          ))}
        </RadarChart>
      );
  }
}

/** Pie slices beyond the categorical palette fold into "Other" instead of reusing colours. */
export function pieData(chart: Chart): { name: string; value: number }[] {
  const key = chart.series[0]!.key;
  const rows = chart.data
    .map((row) => ({ name: String(row[chart.x] ?? ""), value: typeof row[key] === "number" ? row[key] as number : 0 }))
    .filter((row) => row.value > 0);
  if (rows.length <= maxPieSlices) return rows;
  const kept = rows.slice(0, maxPieSlices - 1);
  const other = rows.slice(maxPieSlices - 1).reduce((sum, row) => sum + row.value, 0);
  return [...kept, { name: "Other", value: other }];
}

function ChartTable({ chart }: { chart: Chart }) {
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">{chart.xLabel ?? chart.x}</th>
            {chart.series.map((series) => <th scope="col" key={series.key}>{series.label ?? series.key}</th>)}
          </tr>
        </thead>
        <tbody>
          {chart.data.map((row, index) => (
            <tr key={index}>
              <th scope="row">{String(row[chart.x] ?? "—")}</th>
              {chart.series.map((series) => <td key={series.key}>{formatValue(row[series.key], chart.unit)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
