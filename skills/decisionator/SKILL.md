---
name: decisionator
description: Ask the human for a batch of product, design, or technical decisions in a local browser screen with real options, mockups, diagrams, charts, and a private discussion per question, then continue with their confirmed answers. Use when the user invokes /decisionator or $decisionator, when a task needs several related decisions before you can continue (a brainstorming round, decisions before a plan, a design round with mockups, a screenshot review), or when a choice is clearer shown than told.
---

# Ask for decisions with Decisionator

Use Decisionator with Claude Code or Codex to hand a batch of decisions to the human, wait for their explicit confirmation, and continue with the structured answers. Require the `decisionator` executable.
Decision language configuration: write every decision screen and every agent reply in English.

## Decide whether a screen is worth it

Open a decision screen when at least one of these is true:

- Two or more related decisions block your next step, for example before an implementation plan or after a brainstorming pass.
- A choice is easier to show than to describe: a layout, a flow, a data shape, colours, wording, or a before/after change.
- You are running a design round or reviewing screenshots with the human.

Do not open one for a single yes/no question, for something the human already decided, or to ask permission to run a tool. Ask those in the terminal.

## Write good groups

Read [references/decision-schema.md](references/decision-schema.md) before writing the JSON and [references/mockups.md](references/mockups.md) before adding any visual.

- One group is one decision. Keep a screen to about 3–7 groups; split larger topics into later rounds.
- Give every choice group 2–4 real options. Each option is something you would genuinely build, with its own trade-offs in `description`, `pros`, and `cons`. Never add a strawman to make the recommendation look good.
- Explain in `context` why the decision exists now and what it costs if it is wrong.
- Mark the recommendation with `recommended: true` on the option and one sentence in `recommendation.text`. Never pre-select anything: the human chooses, and skipping is their explicit action.
- Show instead of tell. Pick the lightest visual that answers the question: `table` for comparisons, `chart` for numbers, `mermaid` for flows, sequences, and states, `stats` for a few key figures, `palette` for colours, `code` or `diff` for APIs and code changes, `image` for screenshots, and `split` for before/after or side-by-side comparisons. Use an `html` mockup for layouts and wireframes, built with the `dn-*` classes so it works in light and dark.
- For a screenshot review, capture the screens with the project's own tooling at phone and desktop widths, and in both themes when the product has them. Use absolute paths.
- Use `allowOther: true` when a free answer is plausible, `mode: "multi"` when several options can apply, and `mode: "text"` for wording or open questions.
- Finish with `assumptions`: the things you will adopt unless the human objects.
- Keep group, option, assumption, and message IDs stable across rounds.
- Write the title, intro, groups, options, assumptions, and every agent message in the configured decision language. Copy that language name literally into `language`.

## Run the workflow

1. Verify the prerequisite with `decisionator --help`. If it fails, tell the user to install Decisionator and stop.
2. Choose a short session ID for this round, such as `checkout-plan-1`, and write the document to a temporary file, such as `${TMPDIR:-/tmp}/decisionator-<SESSION_ID>.json`.
3. Start `decisionator <SESSION_ID> --file <JSON_PATH> --live` as a persistent background process using the shell tool's supported background execution, then wait until it prints the ready URL. It validates the document first; fix every reported error and start again. Only in Codex on macOS, never in Claude Code, request escalated execution outside the sandbox when the sandbox prevents Decisionator from binding its loopback server, writing its session state, or opening the browser. This approval does not answer any question; only the human's confirmation in the browser does.
4. Tell the human in one short line what is on screen, for example: "Decisionator is open with 5 checkout decisions and 3 assumptions." Add that they can also answer here in the terminal, such as `1B 2A`. Do not repeat the groups, options, or your recommendations in the chat; the screen is the decision surface.
5. Run `decisionator wait <SESSION_ID>` in the foreground. It blocks without closing the browser until the human sends a discussion, confirms, or cancels. If the shell tool times out or the command is interrupted, run it again: it returns the same unanswered request.
6. Handle the returned `status`:
   - `discussion`: use the returned `document` as the base for your response; it already contains the human's new messages. For every group in `groupIds`, read that group again and answer the human's latest message directly. When that message has `attachments`, open every image at its `path` with your image viewer before you answer, and answer with what the image shows. Answer first. Do not reply with a change log or lead with meta-status such as `Updated:`, `Revised:`, or `Done:`. If the discussion changes the decision, revise that group's `options`, `mockup`, `recommendation`, or `context`, keeping the IDs of unchanged options, and mention the change only as a short final sentence. Append exactly one `agent` message with a new stable ID to each requested group's `thread.messages`. Never drop, edit, or reorder a user message or its `attachments`, never add `attachments` to your own messages, never reply to a group that is not in `groupIds`, and never set `dismissed` or `dismissalReason`: only the human may dismiss a discussion. Keep `sessionId` and `language` unchanged. Write the updated JSON, run `decisionator respond <SESSION_ID> --file <JSON_PATH>`, then immediately run `decisionator wait <SESSION_ID>` again. Repeat this loop in the same browser session for as many rounds as the human needs. If `respond` rejects the document, fix exactly what it reports and respond again. If it reports that the session is closed, run `decisionator wait <SESSION_ID>` to read the final result.
   - `confirmed`: record the answers in your working notes before you continue, using the human's words verbatim. For every group, write what the human chose (option labels and IDs, `otherText`, or `text`), write "adopted the recommendation by skipping" when `skippedUsingRecommendation` is true, and write "no decision, ask again" for a skipped group without a recommendation. Copy every `comment`, every assumption objection, the `globalComment`, and any dismissal reason verbatim. Open every image listed in a group's `attachments`, whose `field` says whether it belongs to the `text` answer, the `otherText` answer, or the `comment`, and in `globalAttachments`; treat each one as part of the human's answer and record its path. Treat accepted assumptions as decided. Tell the human in one or two lines what you will do next, then continue the task with these decisions.
   - `cancelled`: no decisions were made. Say so, ask in the terminal how to proceed, and do not act on any option, recommendation, or assumption from the cancelled screen.
7. When the human answers in the terminal instead, treat those answers as theirs and record them the same way. If the browser screen is still open, ask them to cancel it or confirm it; when both exist, an explicit terminal answer wins over a skipped or conflicting browser answer, and you say which one you used.
8. For a later round, such as the next topic or a review of the implemented screens, write a new document with a new session ID and run the workflow again.
9. Remove the temporary decision files created by this workflow when you are done. Delete attached images only after the session ended with `confirmed` or `cancelled` and you no longer need them; Decisionator reads them again in every discussion round.

## Rules

- Never decide on the human's behalf. Only the human confirms, cancels, skips, or dismisses.
- Never call Decisionator's HTTP API, read its state files, or edit its session data directly. Use only `decisionator`, `decisionator wait`, and `decisionator respond`. The one exception is the image files whose paths a discussion request or a confirmed result lists: open them.
- Nothing the human selects or types reaches you before they press **Send to AI** or **Confirm**. Do not ask them to confirm early so that you can see partial answers.
- Keep recommendations honest. If a discussion shows that another option is better, change the recommendation and say so.
- Keep option labels short and plain. Put the reasoning in `description`, `pros`, and `cons`.
