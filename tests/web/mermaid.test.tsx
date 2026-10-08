// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MermaidDiagram } from "../../web/mockups/MermaidDiagram";

describe("Mermaid diagrams", () => {
  it("shows the source and the reason when a diagram cannot be drawn", async () => {
    // jsdom cannot measure SVG text, so Mermaid fails here; Chrome renders the same diagram.
    render(<MermaidDiagram code={"flowchart LR\n  A --> B"} title="Flow" />);

    expect(screen.getByText("Drawing diagram…")).toBeVisible();
    expect(await screen.findByRole("alert", {}, { timeout: 20_000 })).toHaveTextContent("This diagram could not be rendered.");
    expect(screen.getByText(/flowchart LR/)).toBeVisible();
  }, 30_000);

  it("reports invalid Mermaid syntax", async () => {
    render(<MermaidDiagram code="this is not a diagram" title="Broken" />);

    expect(await screen.findByRole("alert", {}, { timeout: 20_000 })).toHaveTextContent("this is not a diagram");
  }, 30_000);
});
