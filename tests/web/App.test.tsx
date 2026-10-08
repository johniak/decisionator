import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseDecisionDocument } from "../../src/domain/decision";
import { App } from "../../web/App";
import { draftStorageKey } from "../../web/draft";
import { decisionInput } from "../fixtures";
import { agentReply, startHarness } from "./harness";

beforeEach(() => window.localStorage.clear());

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

function card(groupId: string) {
  return within(document.getElementById(`group-${groupId}`)!);
}

async function renderApp() {
  render(<App />);
  await screen.findByRole("heading", { name: "Checkout layout" });
}

function answerEverything() {
  fireEvent.click(card("layout").getByRole("radio", { name: /Three steps/ }));
  fireEvent.click(card("notifications").getByRole("checkbox", { name: /Email/ }));
  fireEvent.change(card("copy").getByPlaceholderText("Write your answer…"), { target: { value: "Thanks for your order" } });
}

describe("Decisionator workspace", () => {
  it("shows the session, every group, and the progress line", async () => {
    await startHarness();
    await renderApp();

    expect(screen.getByRole("heading", { level: 1, name: "Checkout redesign — decisions before plan 2" })).toBeVisible();
    expect(screen.getByText(/Three decisions block the implementation plan/)).toBeVisible();
    expect(screen.getByText("0 of 3 answered")).toBeVisible();
    expect(screen.getByText("Live")).toBeVisible();
    expect(card("layout").getByText("Recommended")).toBeVisible();
    expect(card("layout").getByText(/The agent recommends Three steps/)).toBeVisible();
    expect(card("layout").getByRole("radio", { name: /Three steps/ })).not.toBeChecked();
    expect(card("notifications").getByRole("checkbox", { name: /Other/ })).toBeVisible();
  });

  it("keeps every selection and comment local until the human acts", async () => {
    const { requests, sent } = await startHarness();
    await renderApp();

    answerEverything();
    fireEvent.change(card("layout").getByPlaceholderText("Add context, a condition, or a concern…"), {
      target: { value: "Short address step" },
    });

    expect(screen.getByText("3 of 3 answered")).toBeVisible();
    expect(within(screen.getByRole("complementary", { name: "Your answers" })).getByText("B. Three steps")).toBeVisible();
    expect(requests.every((request) => request.method === "GET")).toBe(true);
    expect(sent("/api/discussion")).toHaveLength(0);
    expect(sent("/api/confirm")).toHaveLength(0);
  });

  it("sends only the group's thread to the AI and shows the reply in the same session", async () => {
    const { session, sent } = await startHarness();
    await renderApp();
    fireEvent.click(card("layout").getByRole("radio", { name: /Three steps/ }));

    fireEvent.click(card("notifications").getByRole("button", { name: "Discuss with AI" }));
    fireEvent.change(card("notifications").getByLabelText("Ask the AI agent about this decision"), {
      target: { value: "Is SMS worth it?" },
    });
    fireEvent.click(card("notifications").getByRole("button", { name: "Send to AI" }));

    await waitFor(() => expect(sent("/api/discussion")).toHaveLength(1));
    expect(sent("/api/discussion")[0]!.body).toEqual({ items: [{ groupId: "notifications", message: "Is SMS worth it?" }] });
    expect(await screen.findByText("AI working")).toBeVisible();
    expect(card("notifications").getByText("Waiting for agent")).toBeVisible();
    expect(card("notifications").getByRole("status")).toHaveTextContent("The AI agent is answering this discussion.");

    await act(async () => {
      await agentReply(session, "SMS costs €0.06 per order; I added WhatsApp as an alternative.", (next) => {
        next.groups[1]!.options.push({ id: "whatsapp", label: "WhatsApp", description: "Business API." });
      });
    });

    expect(await card("notifications").findByText(/SMS costs €0.06 per order/)).toBeVisible();
    expect(card("notifications").getByText("Revised in version 2")).toBeVisible();
    expect(card("notifications").getByText("The AI agent changed the options.")).toBeVisible();
    expect(card("notifications").getByRole("checkbox", { name: /WhatsApp/ })).toBeVisible();
    expect(screen.getByText("Version 2")).toBeVisible();
    expect(screen.getByText("Live")).toBeVisible();
    expect(card("layout").getByRole("radio", { name: /Three steps/ })).toBeChecked();
  });

  it("sends several prepared discussions together and blocks confirmation until they are sent", async () => {
    const { session, sent } = await startHarness();
    await renderApp();

    for (const groupId of ["layout", "copy"]) {
      fireEvent.click(card(groupId).getByRole("button", { name: "Discuss with AI" }));
      fireEvent.change(card(groupId).getByLabelText("Ask the AI agent about this decision"), {
        target: { value: `Question about ${groupId}` },
      });
    }

    expect(screen.getByRole("button", { name: /Review and confirm/ })).toBeDisabled();
    expect(screen.getByText("Send or clear your prepared discussions before confirming.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Send 2 prepared discussions" }));

    await waitFor(() => expect(sent("/api/discussion")).toHaveLength(1));
    expect(sent("/api/discussion")[0]!.body).toEqual({
      items: [
        { groupId: "layout", message: "Question about layout" },
        { groupId: "copy", message: "Question about copy" },
      ],
    });
    await expect(session.waitForAgentRequest()).resolves.toMatchObject({ groupIds: ["layout", "copy"] });
    await waitFor(() => expect(screen.getByRole("button", { name: /Review and confirm/ })).toBeEnabled());
  });

  it("restores the draft after the page reloads", async () => {
    await startHarness();
    const { unmount } = render(<App />);
    await screen.findByRole("heading", { name: "Checkout layout" });
    answerEverything();
    fireEvent.change(screen.getByPlaceholderText(/A constraint, a deadline/), { target: { value: "Ship it" } });
    unmount();

    await renderApp();

    expect(card("layout").getByRole("radio", { name: /Three steps/ })).toBeChecked();
    expect(card("copy").getByPlaceholderText("Write your answer…")).toHaveValue("Thanks for your order");
    expect(screen.getByPlaceholderText(/A constraint, a deadline/)).toHaveValue("Ship it");
    expect(JSON.parse(window.localStorage.getItem(draftStorageKey("checkout-redesign"))!).groups.layout.selectedOptionIds)
      .toEqual(["steps"]);
  });

  it("drops a choice the agent removed and tells the human", async () => {
    const { session } = await startHarness();
    await renderApp();
    fireEvent.click(card("layout").getByRole("radio", { name: /One page/ }));
    fireEvent.click(card("layout").getByRole("button", { name: "Discuss with AI" }));
    fireEvent.change(card("layout").getByLabelText("Ask the AI agent about this decision"), { target: { value: "Drop one page?" } });
    fireEvent.click(card("layout").getByRole("button", { name: "Send to AI" }));

    await act(async () => {
      await agentReply(session, "Yes, it no longer fits the phone goal.", (next) => {
        next.groups[0]!.options.splice(0, 1, { id: "wizard", label: "Wizard", description: "A guided flow." });
      });
    });

    expect(await card("layout").findByText(/Your previous choice “One page” is no longer an option/)).toBeVisible();
    expect(card("layout").queryAllByRole("radio").filter((radio) => (radio as HTMLInputElement).checked)).toHaveLength(0);
  });

  it("asks before skipping unanswered groups and previews exactly what is returned", async () => {
    const { session } = await startHarness();
    await renderApp();
    fireEvent.click(card("notifications").getByRole("checkbox", { name: /Email/ }));
    fireEvent.change(card("notifications").getByRole("textbox", { name: /Other answer/ }), { target: { value: "Slack" } });
    const assumption = screen.getAllByRole("group", { name: /Response to assumption/ })[1]!;
    fireEvent.click(within(assumption).getByRole("button", { name: "Object" }));
    fireEvent.change(screen.getByPlaceholderText("Explain your objection…"), { target: { value: "Accounts for subscriptions" } });
    fireEvent.change(screen.getByPlaceholderText(/A constraint, a deadline/), { target: { value: "Keep it small" } });

    fireEvent.click(screen.getByRole("button", { name: /Review and confirm/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Some questions have no answer")).toBeVisible();
    expect(within(dialog).getByText(/If skipped, the agent uses its recommendation/)).toHaveTextContent("Three steps");
    expect(within(dialog).getByText(/No recommendation. If skipped, no decision is recorded/)).toBeVisible();

    fireEvent.click(within(dialog).getByRole("button", { name: "Skip these 2 and use the recommendations" }));
    expect(within(dialog).getByText("Send these decisions to the AI agent?")).toBeVisible();
    expect(within(dialog).getByText("Skipped, recommendation adopted")).toBeVisible();
    expect(within(dialog).getByText("Skipped, no decision")).toBeVisible();
    expect(within(dialog).getByText("Other: Slack")).toBeVisible();
    expect(within(dialog).getByText(/Objection: Accounts for subscriptions/)).toBeVisible();

    fireEvent.click(within(dialog).getByRole("tab", { name: /Exact JSON/ }));
    const preview = JSON.parse(within(dialog).getByTestId("result-json").textContent!);
    const send = within(dialog).getByRole("button", { name: /Send decisions/ });
    expect(send).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /I confirm these decisions/ }));
    fireEvent.click(send);

    expect(await screen.findByRole("heading", { name: "Decisions sent" })).toBeVisible();
    const result = await session.waitForResult();
    expect(preview).toEqual(result);
    expect(result).toMatchObject({
      status: "confirmed",
      answers: {
        groups: [
          { groupId: "layout", status: "skipped", selectedOptionIds: ["steps"], skippedUsingRecommendation: true },
          { groupId: "notifications", status: "answered", selectedOptionIds: ["email"], otherText: "Slack" },
          { groupId: "copy", status: "skipped", selectedOptionIds: [], skippedUsingRecommendation: false },
        ],
        assumptions: [
          { id: "currency", accepted: true, objection: null },
          { id: "guest", accepted: false, objection: "Accounts for subscriptions" },
        ],
        globalComment: "Keep it small",
      },
    });
    expect(screen.getByText("Other: Slack")).toBeVisible();
    expect(window.localStorage.getItem(draftStorageKey("checkout-redesign"))).toBeNull();
  });

  it("requires an explanation for an objection before confirming", async () => {
    await startHarness();
    await renderApp();
    answerEverything();
    const assumption = screen.getAllByRole("group", { name: /Response to assumption/ })[0]!;
    fireEvent.click(within(assumption).getByRole("button", { name: "Object" }));

    fireEvent.click(screen.getByRole("button", { name: /Review and confirm/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Explain your objection to assumption currency.");
    expect(within(dialog).queryByRole("button", { name: /Send decisions/ })).toBeNull();
  });

  it("records the human's dismissal of a discussion with the decisions", async () => {
    const input = decisionInput();
    input.groups[0]!.thread = {
      messages: [
        { id: "u1", author: "user", body: "Why steps?" },
        { id: "a1", author: "agent", body: "Shorter payment step." },
      ],
    };
    const { session } = await startHarness(parseDecisionDocument(input));
    await renderApp();
    answerEverything();

    expect(card("layout").queryByText("New reply")).toBeNull();
    fireEvent.click(card("layout").getByRole("button", { name: "Dismiss discussion" }));
    fireEvent.change(card("layout").getByLabelText("Why are you closing this discussion?"), { target: { value: "Clear now" } });
    fireEvent.click(screen.getByRole("button", { name: /Review and confirm/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/dismissed: Clear now/)).toBeVisible();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /I confirm these decisions/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: /Send decisions/ }));

    await expect(session.waitForResult()).resolves.toMatchObject({
      answers: { groups: [{ thread: { dismissed: true, dismissalReason: "Clear now", messages: [{ id: "u1" }, { id: "a1" }] } }, {}, {}] },
    });
  });

  it("shows earlier versions read-only", async () => {
    const { session } = await startHarness();
    await renderApp();
    fireEvent.click(card("copy").getByRole("button", { name: "Discuss with AI" }));
    fireEvent.change(card("copy").getByLabelText("Ask the AI agent about this decision"), { target: { value: "Suggest one" } });
    fireEvent.click(card("copy").getByRole("button", { name: "Send to AI" }));
    await act(async () => {
      await agentReply(session, "Try: Your order is on its way.", (next) => { next.groups[2]!.title = "Confirmation headline (new)"; });
    });
    await screen.findByText("Version 2");

    fireEvent.click(screen.getByRole("tab", { name: /History/ }));
    fireEvent.click(screen.getByRole("button", { name: /v1 First version/ }));

    expect(screen.getByText("You are viewing version 1. It is read-only.")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Confirmation headline" })).toBeVisible();
    expect(card("layout").getByRole("radio", { name: /Three steps/ })).toBeDisabled();
    expect(card("copy").queryByText("Try: Your order is on its way.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Back to version 2/ }));
    expect(screen.getByRole("heading", { name: "Confirmation headline (new)" })).toBeVisible();
  });

  it("cancels without sending decisions", async () => {
    const { session } = await startHarness();
    await renderApp();
    answerEverything();

    fireEvent.click(screen.getByRole("button", { name: /Cancel session/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Cancel session/ }));

    expect(await screen.findByRole("heading", { name: "Session cancelled" })).toBeVisible();
    await expect(session.waitForResult()).resolves.toEqual({ status: "cancelled", sessionId: "checkout-redesign" });
  });

  it("supports keyboard navigation and choosing options by number", async () => {
    await startHarness();
    await renderApp();

    fireEvent.keyDown(window, { key: "2" });
    expect(card("layout").getByRole("radio", { name: /Three steps/ })).toBeChecked();
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "1" });
    fireEvent.keyDown(window, { key: "3" });
    expect(card("notifications").getByRole("checkbox", { name: /Email/ })).toBeChecked();
    expect(card("notifications").getByRole("checkbox", { name: /Push/ })).toBeChecked();
    fireEvent.keyDown(window, { key: "?" });
    expect(await screen.findByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  });

  it("explains a missing session token", async () => {
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Could not open Decisionator" })).toBeVisible();
    expect(screen.getByText("This Decisionator link is missing its session token.")).toBeVisible();
  });

  it("ends a non-live session after a discussion is sent", async () => {
    const { session } = await startHarness(undefined, false);
    await renderApp();
    fireEvent.click(card("copy").getByRole("button", { name: "Discuss with AI" }));
    fireEvent.change(card("copy").getByLabelText("Ask the AI agent about this decision"), { target: { value: "Ideas?" } });
    fireEvent.click(card("copy").getByRole("button", { name: "Send to AI" }));

    expect(await screen.findByRole("heading", { name: "Discussion sent" })).toBeVisible();
    await expect(session.waitForResult()).resolves.toMatchObject({ status: "discussion", groupIds: ["copy"] });
  });
});
