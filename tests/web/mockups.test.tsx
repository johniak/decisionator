import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { mockupSchema, type Mockup } from "../../src/domain/decision";
import { languageTag } from "../../web/language";
import { readableInk } from "../../web/mockups/Blocks";
import { formatValue, pieData } from "../../web/mockups/ChartBlock";
import { MockupView } from "../../web/mockups/MockupView";

function show(input: unknown, resolveAsset: (path: string) => string | undefined = () => undefined) {
  const mockup = mockupSchema.parse(input) as Mockup;
  return render(<MockupView mockup={mockup} title="Example" resolveAsset={resolveAsset} />);
}

describe("mockup rendering", () => {
  it("renders HTML in a script-free sandboxed frame with a theme switch and an enlarged view", () => {
    show({ kind: "html", body: "<p>Hello</p>", theme: "light", caption: "Wireframe" });

    const frame = screen.getByTitle("Example") as HTMLIFrameElement;
    expect(frame.getAttribute("sandbox")).toBe("allow-same-origin");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame.getAttribute("srcdoc")).toContain('data-theme="light"');
    expect(frame.getAttribute("srcdoc")).toContain("Content-Security-Policy");
    expect(screen.getByText("Wireframe")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /Dark/ }));
    expect(frame.getAttribute("srcdoc")).toContain('data-theme="dark"');
    fireEvent.click(screen.getByRole("button", { name: "Enlarge Example" }));
    expect(screen.getByRole("dialog", { name: "Example" })).toBeVisible();
    expect(screen.getByTitle("Example (enlarged)").getAttribute("sandbox")).toBe("allow-same-origin");
  });

  it("serves images only through resolved snapshot URLs and enlarges them on click", () => {
    show({ kind: "image", path: "/shots/home.png", alt: "Home screen", width: 300 }, (path) => path === "/shots/home.png" ? "/api/assets/abc?token=t" : undefined);

    const image = screen.getByRole("img", { name: "Home screen" });
    expect(image).toHaveAttribute("src", "/api/assets/abc?token=t");
    expect(image).toHaveStyle({ width: "300px" });
    fireEvent.click(screen.getByRole("button", { name: "Enlarge Home screen" }));
    expect(within(screen.getByRole("dialog")).getByRole("img", { name: "Home screen" })).toBeVisible();
  });

  it("explains an image that is not part of the shown version", () => {
    show({ kind: "image", path: "/shots/missing.png", alt: "Old screen" });
    expect(screen.getByText("Old screen is not available in this version.")).toBeVisible();
  });

  it("renders split comparisons with labels on both sides", () => {
    show({
      kind: "split",
      leftLabel: "Before",
      rightLabel: "After",
      left: { kind: "stats", items: [{ label: "Load", value: "2.1 s" }] },
      right: { kind: "stats", items: [{ label: "Load", value: "0.9 s", tone: "positive", detail: "-57%" }] },
    });

    expect(screen.getByText("Before")).toBeVisible();
    expect(screen.getByText("After")).toBeVisible();
    expect(screen.getByText("2.1 s")).toBeVisible();
    expect(screen.getByText("-57%")).toBeVisible();
  });

  it("renders comparison tables with yes, no, and not-applicable cells", () => {
    show({
      kind: "table",
      columns: ["Capability", "A", "B"],
      rows: [["Offline", true, false], ["Price", 1200, null], ["Notes", "**fast**", "slow"]],
      highlightColumn: 1,
    });

    const table = screen.getByRole("table");
    expect(within(table).getByText("Yes")).toBeInTheDocument();
    expect(within(table).getByText("No")).toBeInTheDocument();
    expect(within(table).getByText("Not applicable")).toBeInTheDocument();
    expect(within(table).getByText("1,200")).toBeVisible();
    expect(within(table).getByText("fast").tagName).toBe("STRONG");
    expect(within(table).getByRole("columnheader", { name: "A" })).toHaveClass("highlighted");
  });

  it("renders palettes with readable sample text", () => {
    show({ kind: "palette", colors: [{ name: "Ink", value: "#111111", usage: "Body text" }, { name: "Paper", value: "#fafafa" }] });

    expect(screen.getByText("Ink")).toBeVisible();
    expect(screen.getByText("Body text")).toBeVisible();
    expect(readableInk("#111111")).toBe("#ffffff");
    expect(readableInk("#fafafa")).toBe("#111318");
    expect(readableInk("#fff")).toBe("#111318");
    expect(readableInk("oklch(0.5 0.1 200)")).toBe("#ffffff");
  });

  it("renders charts with a legend and a data table", () => {
    show({
      kind: "chart",
      type: "bar",
      x: "month",
      unit: "€",
      series: [{ key: "a", label: "Plan A" }, { key: "b", label: "Plan B" }],
      data: [{ month: "Jan", a: 1200, b: 900 }, { month: "Feb", a: 1300, b: null }],
    });

    expect(screen.getByRole("list", { name: "Legend" })).toHaveTextContent("Plan APlan B");
    expect(screen.getByRole("img", { name: /bar chart of Plan A, Plan B by month/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show data" }));
    const table = screen.getByRole("table");
    expect(within(table).getByText("€1,200")).toBeVisible();
    expect(within(table).getByText("—")).toBeVisible();
  });

  it("formats chart values and folds extra pie slices into Other", () => {
    expect(formatValue(1234.5, "€")).toBe("€1,234.5");
    expect(formatValue(12, "%")).toBe("12%");
    expect(formatValue(180, "ms")).toBe("180 ms");
    expect(formatValue(6000, "€", true)).toBe("€6K");
    expect(formatValue(null)).toBe("—");
    const chart = mockupSchema.parse({
      kind: "chart",
      type: "pie",
      x: "name",
      series: [{ key: "value" }],
      data: Array.from({ length: 10 }, (_, index) => ({ name: `S${index}`, value: index + 1 })),
    }) as Extract<Mockup, { kind: "chart" }>;
    const slices = pieData(chart);
    expect(slices).toHaveLength(8);
    expect(slices.at(-1)).toEqual({ name: "Other", value: 8 + 9 + 10 });
  });

  it("renders highlighted code with line numbers", async () => {
    const { container } = show({ kind: "code", language: "json", filename: "response.json", code: "{\n  \"ok\": true\n}" });

    expect(screen.getByText("response.json")).toBeVisible();
    expect(container.querySelectorAll(".line-number")).toHaveLength(3);
    await waitFor(() => expect(container.querySelector(".line-code span[style]")).not.toBeNull());
  });

  it("renders diffs in unified and split layouts and expands collapsed lines", () => {
    const before = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join("\n");
    const { container } = show({ kind: "diff", filename: "notes.txt", before, after: before.replace("line 10", "line ten") });

    expect(screen.getByText("+1")).toBeVisible();
    expect(screen.getByText("−1")).toBeVisible();
    expect(container.querySelector(".diff-removed")).toHaveTextContent("line 10");
    expect(container.querySelector(".diff-added")).toHaveTextContent("line ten");
    fireEvent.click(screen.getByRole("button", { name: "Show 6 unchanged lines" }));
    expect(screen.getByText("line 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Split/ }));
    expect(container.querySelector(".code-table.split")).not.toBeNull();
  });

  it("maps configured language names to HTML lang tags", () => {
    expect(languageTag("Polish")).toBe("pl");
    expect(languageTag("English")).toBe("en");
    expect(languageTag("pt-BR")).toBe("pt-BR");
    expect(languageTag("Klingon")).toBeUndefined();
    expect(languageTag(undefined)).toBeUndefined();
  });
});
