import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../web/App";
import { pngBytes } from "../fixtures";
import { agentReply, startHarness } from "./harness";

beforeEach(() => window.localStorage.clear());

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function image(name: string, seed: number) {
  return new File([pngBytes(seed)], name, { type: "image/png" });
}

function card(groupId: string) {
  return within(document.getElementById(`group-${groupId}`)!);
}

function commentImages(groupId: string) {
  return within(card(groupId).getByRole("list", { name: "Images attached to your comment" })).getAllByRole("button", { name: /^Enlarge / });
}

async function renderApp() {
  render(<App />);
  await screen.findByRole("heading", { name: "Checkout layout" });
}

async function confirmAll() {
  fireEvent.click(screen.getByRole("button", { name: /Review and confirm/ }));
  const dialog = await screen.findByRole("dialog");
  const skip = within(dialog).queryByRole("button", { name: /^Skip / });
  if (skip) fireEvent.click(skip);
  fireEvent.click(within(dialog).getByRole("tab", { name: /Exact JSON/ }));
  const preview = JSON.parse(within(dialog).getByTestId("result-json").textContent!);
  fireEvent.click(within(dialog).getByRole("checkbox", { name: /I confirm these decisions/ }));
  fireEvent.click(within(dialog).getByRole("button", { name: /Send decisions/ }));
  await screen.findByRole("heading", { name: "Decisions sent" });
  return preview;
}

describe("attached images", () => {
  it("answers a text question with a chosen image and sends the file only on confirm", async () => {
    const { session, sent } = await startHarness();
    await renderApp();
    const user = userEvent.setup();

    await user.upload(card("copy").getByLabelText("Choose images to attach to your answer"), image("headline.png", 1));

    expect(await card("copy").findByRole("button", { name: "Enlarge headline.png" })).toBeVisible();
    expect(card("copy").getByRole("img", { name: "headline.png" })).toHaveAttribute("src", expect.stringMatching(/^blob:/));
    expect(card("copy").getByText("Answered")).toBeVisible();
    expect(sent("/api/attachments")).toHaveLength(0);

    const preview = await confirmAll();
    const result = await session.waitForResult();
    const path = `${session.snapshot().attachmentDirectory}/${sha256(pngBytes(1))}.png`;
    expect(preview).toEqual(result);
    expect(result).toMatchObject({
      answers: { groups: [{}, {}, { groupId: "copy", status: "answered", text: null, attachments: [{ field: "text", path, name: "headline.png" }] }] },
    });
    expect(sent("/api/attachments")).toHaveLength(1);
    expect(new Uint8Array(readFileSync(path))).toEqual(pngBytes(1));
  });

  it("pastes and drops images on a comment, ignores duplicates, and removes one", async () => {
    await startHarness();
    await renderApp();
    const comment = card("layout").getByPlaceholderText("Add context, a condition, or a concern…");

    const textPaste = fireEvent.paste(comment, { clipboardData: { files: [], types: ["text/plain"] } });
    expect(textPaste).toBe(true);
    const imagePaste = fireEvent.paste(comment, { clipboardData: { files: [image("pasted.png", 2)], types: ["Files"] } });
    expect(imagePaste).toBe(false);
    expect(await card("layout").findByRole("button", { name: "Enlarge pasted.png" })).toBeVisible();

    fireEvent.dragOver(comment, { dataTransfer: { files: [], types: ["Files"] } });
    fireEvent.drop(comment, { dataTransfer: { files: [image("dropped.png", 3), image("again.png", 2)], types: ["Files"] } });
    expect(await card("layout").findByRole("button", { name: "Enlarge dropped.png" })).toBeVisible();
    expect(commentImages("layout")).toHaveLength(2);

    fireEvent.click(card("layout").getByRole("button", { name: "Remove pasted.png" }));
    expect(card("layout").queryByRole("button", { name: "Enlarge pasted.png" })).toBeNull();
    expect(card("layout").getByRole("button", { name: "Enlarge dropped.png" })).toBeVisible();
  });

  it("refuses files that are not supported images and more than ten images", async () => {
    await startHarness();
    await renderApp();
    const user = userEvent.setup();
    const input = card("layout").getByLabelText("Choose images to attach to your comment");

    await user.upload(input, new File(["<svg></svg>"], "logo.png", { type: "image/png" }));
    expect(await card("layout").findByRole("alert")).toHaveTextContent("logo.png is not a PNG, JPEG, GIF, or WebP image.");

    await user.upload(input, Array.from({ length: 11 }, (_, index) => image(`shot-${index}.png`, 10 + index)));
    expect(await card("layout").findByText("You can attach up to 10 images here.")).toBeVisible();
    expect(commentImages("layout")).toHaveLength(10);
  });

  it("sends an image with a discussion and shows it in the thread", async () => {
    const { session, sent } = await startHarness();
    await renderApp();
    const user = userEvent.setup();

    fireEvent.click(card("layout").getByRole("button", { name: "Discuss with AI" }));
    fireEvent.change(card("layout").getByLabelText("Ask the AI agent about this decision"), { target: { value: "See the overlap." } });
    await user.upload(card("layout").getByLabelText("Choose images to attach to your message"), image("overlap.png", 4));
    await card("layout").findByRole("button", { name: "Enlarge overlap.png" });
    fireEvent.click(card("layout").getByRole("button", { name: "Send to AI" }));

    await waitFor(() => expect(sent("/api/discussion")).toHaveLength(1));
    expect(sent("/api/attachments")).toHaveLength(1);
    expect(sent("/api/discussion")[0]!.body).toEqual({
      items: [{
        groupId: "layout",
        message: "See the overlap.",
        attachments: [{ id: sha256(pngBytes(4)), type: "image/png", name: "overlap.png" }],
      }],
    });
    const thread = within(card("layout").getByRole("region", { name: /Discussion about/ }));
    expect(await thread.findByRole("img", { name: "overlap.png" })).toHaveAttribute("src", expect.stringMatching(/^\/api\/assets\//));
    expect(card("layout").queryByLabelText("Choose images to attach to your message")).toBeNull();

    await act(async () => {
      await agentReply(session, "The total moves above the button.");
    });
    expect(await card("layout").findByText("The total moves above the button.")).toBeVisible();
    expect(thread.getByRole("img", { name: "overlap.png" })).toBeVisible();
  });

  it("answers Other with an image and attaches images to the final comment", async () => {
    const { session } = await startHarness();
    await renderApp();
    const user = userEvent.setup();

    expect(card("notifications").queryByLabelText("Choose images to attach to your Other answer")).toBeNull();
    fireEvent.click(card("notifications").getByRole("checkbox", { name: /Other/ }));
    await user.upload(card("notifications").getByLabelText("Choose images to attach to your Other answer"), image("slack.png", 5));
    await card("notifications").findByRole("button", { name: "Enlarge slack.png" });
    await user.upload(screen.getByLabelText("Choose images to attach to your final comment"), image("roadmap.png", 6));
    await screen.findByRole("button", { name: "Enlarge roadmap.png" });

    await confirmAll();
    const result = await session.waitForResult();
    expect(result).toMatchObject({
      answers: {
        groups: [{}, { groupId: "notifications", status: "answered", otherText: null, attachments: [{ field: "otherText", name: "slack.png" }] }, {}],
        globalAttachments: [{ name: "roadmap.png", type: "image/png" }],
      },
    });
  });
});
