// IndexedDB is a browser API that happy-dom lacks; fake-indexeddb provides a complete implementation.
import "fake-indexeddb/auto";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, keys } from "idb-keyval";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../../web/App";
import { pngBytes } from "../fixtures";
import { startHarness } from "./harness";

beforeEach(() => window.localStorage.clear());

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

function card(groupId: string) {
  return within(document.getElementById(`group-${groupId}`)!);
}

it("restores attached images after a reload and forgets them once the decisions are sent", async () => {
  const { session } = await startHarness();
  const first = render(<App />);
  await screen.findByRole("heading", { name: "Checkout layout" });
  await userEvent.setup().upload(
    card("copy").getByLabelText("Choose images to attach to your answer"),
    new File([pngBytes(1)], "headline.png", { type: "image/png" }),
  );
  await card("copy").findByRole("img", { name: "headline.png" });
  first.unmount();

  render(<App />);
  await screen.findByRole("heading", { name: "Checkout layout" });
  expect(await card("copy").findByRole("img", { name: "headline.png" })).toHaveAttribute("src", expect.stringMatching(/^blob:/));
  expect(await keys(createStore("decisionator", "attachments"))).toHaveLength(1);

  fireEvent.click(screen.getByRole("button", { name: /Review and confirm/ }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: /^Skip / }));
  expect(await within(dialog).findByRole("img", { name: "headline.png" })).toBeVisible();
  fireEvent.click(within(dialog).getByRole("checkbox", { name: /I confirm these decisions/ }));
  fireEvent.click(within(dialog).getByRole("button", { name: /Send decisions/ }));
  await screen.findByRole("heading", { name: "Decisions sent" });

  await expect(session.waitForResult()).resolves.toMatchObject({
    answers: { groups: [{}, {}, { groupId: "copy", attachments: [{ field: "text", name: "headline.png" }] }] },
  });
  await vi.waitFor(async () => expect(await keys(createStore("decisionator", "attachments"))).toEqual([]));
});
