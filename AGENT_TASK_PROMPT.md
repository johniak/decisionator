# Agent benchmark task: build Decisionator

You are responsible for designing and implementing a complete, installable application called **Decisionator**. Work autonomously: inspect the repository first, make reasonable product and technical decisions, implement the solution, test it, and provide concise instructions for running and verifying it.

Do not merely prepare a plan or a prototype. Deliver a working application.

## Product goal

Decisionator is a local, human-in-the-loop interface for **batched decisions** between an AI coding agent and a human. When an agent needs several product or design decisions before it can continue (a brainstorming round, "decisions before plan N", a design round with mockups, a screenshot review), it writes one structured decision document and opens a polished browser UI. The human reads every group of options with its mockups, picks answers, writes comments, discusses individual groups with the agent live, and finally **confirms** the whole batch. The agent blocks until that confirmation and then continues with structured answers.

Its interaction model must follow **Reviewonator** (https://github.com/johniak/reviewonator): the same architecture (Bun-compiled CLI, loopback-only Hono server, single-file Vite + React UI), the same agent protocol (`run --live` in the background, blocking `wait` in the foreground, `respond` with an updated document, one browser session across all rounds), the same installer and skill layout for **Claude Code and Codex**, and the same discussion model (private per-item threads with "Send to AI", the agent answering inside the same page, only the human may dismiss a thread). Study Reviewonator's source, skill and docs before designing; reuse its patterns and libraries instead of inventing new ones.

The reference for the **content** of a decision screen is how a careful colleague asks for decisions in a terminal-free way:

- several groups per screen, each one decision, each with 2–4 fully drawn options;
- every option is a real option with its own trade-offs: the recommendation is marked, but never collapsed or pre-selected, and the recommendation text is one sentence;
- hard-to-describe things are shown, not told: wireframes, side-by-side layouts, flow diagrams, screenshots at phone and desktop widths, both light and dark themes;
- a closing list of "assumptions I will adopt unless you object";
- the human can answer in the browser, in the terminal, or both.

## Required workflow

1. The agent (via the installed Claude Code or Codex skill, or on its own judgement when a task needs decisions) writes a validated structured decision document (JSON) describing one screen: title, intro, groups, options, mockups, assumptions.
2. The skill verifies that Decisionator is installed, starts `decisionator <SESSION_ID> --file <JSON_PATH> --live` as a persistent background process, waits for the ready URL, opens the browser (reusing the open tab when a session with the same ID is already live), and tells the human in one short line what is on screen and where.
3. The skill runs `decisionator wait <SESSION_ID>` in the foreground. It blocks, without closing the browser, until the human either sends a discussion or confirms or cancels.
4. **Nothing reaches the agent before an explicit action.** Clicking options and typing comments only changes local state. Two actions send data:
   - **Send to AI** on a single group (or the bottom "Send prepared discussions" action for several groups at once) sends only that group's thread as a `discussion` request. The agent answers inside the same thread, may revise that group (options, mockup, recommendation, context), writes the updated document, runs `decisionator respond <SESSION_ID> --file <JSON_PATH>`, and immediately runs `wait` again. The human sees the reply and the revised group highlighted in the same browser session.
   - **Confirm** sends the whole batch as a `confirmed` result: for each group the selected option IDs (or the free-text "Other" answer), the group's final comment, the full thread; the accepted or rejected assumptions with objections; one global comment. Groups left without an answer are listed in the confirmation dialog and the human must explicitly accept "skip these, use the recommendation" or go back.
   - **Cancel** returns `cancelled`; the agent must treat it as "no decisions made" and say so.
5. The agent handles the returned status: on `discussion` it re-reads the exact group, answers the human's latest message directly (answer first, no change log, no meta-status), updates the document, responds and waits again; on `confirmed` it records the answers (what the human chose, which recommendations were adopted by skipping, every comment verbatim) and continues its task; on `cancelled` it stops and asks in the terminal.
6. Later rounds (a revised screen, the next topic, a screenshot review) reuse the same live session and the same browser tab: the agent writes a new document version and calls `respond`; the UI shows version history and lets the human look back at earlier rounds and their answers.

The skill must never decide on the human's behalf. Only the human confirms; skipping a group is an explicit human action recorded in the result as "adopted the recommendation by skipping".

## Decision document

Design a documented, validated JSON contract (zod schema, versioned) that supports at least:

- `version`, `sessionId`, `title`, `intro` (Markdown), `language`;
- `groups[]`: stable `id`, `title`, `context` (Markdown: why this decision exists and what it costs if wrong), `mode` (`single` | `multi` | `text`), `options[]`, `recommendation` (one sentence, optional, referencing an option ID), `allowOther` (free-text answer), `thread` (messages alternating `user`/`agent`, each with stable IDs, plus `dismissed` and `dismissalReason` that only the human may set), `status` derived by the UI (`pending`, `answered`, `waiting_for_agent`, `agent_replied`, `skipped`);
- `options[]`: stable `id`, `label`, `description` (Markdown, trade-offs included), `recommended` flag, optional `mockup`;
- `mockup`: either `{ kind: "html", body }` rendered in a sandboxed iframe with the tool's neutral styles and both themes, or `{ kind: "image", path, alt, width }` for local screenshot files served read-only by the local server (the agent passes absolute paths; the server never serves anything outside the paths listed in the document), or `{ kind: "split", left, right }` for side-by-side comparisons;
- `assumptions[]`: stable `id`, `text`, `accepted` (set by the human), `objection` (free text);
- `versions`: the document keeps earlier rounds (or references to them) so the UI can show history and the agent can see what changed;
- `answers` filled by the UI on confirm: per group `selectedOptionIds`, `otherText`, `comment`, `skippedUsingRecommendation`; per assumption `accepted`/`objection`; `globalComment`.

Document the contract in the skill's `references/` folder, the way Reviewonator documents its review schema, with one complete example that includes a mockup of each kind and a thread.

## Browser UI requirements

The application must be visually polished, coherent, keyboard-usable, and entirely in English (the agent-authored content keeps the language the agent wrote it in).

It must show:

- the session title and intro;
- a left sidebar listing groups with their status and a progress line ("3 of 7 answered, 1 waiting for agent");
- each group as a card: context, options with their descriptions and mockups, the recommendation marked subtly (a label, not a pre-selection), the selection controls (radio, checkboxes, or a text field), an "Other" field when allowed, a private comment field, and the discussion thread with **Send to AI**;
- mockups rendered safely: HTML in a sandboxed iframe sized to content, images with zoom-on-click, split views side by side on desktop and stacked on phone widths;
- the assumptions list with accept/object controls;
- version history: earlier rounds readable, with the answers the human gave then;
- a header state when the agent is working ("AI working") and a clear marker on every group the agent revised in the latest round;
- a **Confirm** dialog with an exact preview of what will be returned (every answer, every comment, skipped groups with the recommendation that will apply) and a separate, unambiguous confirmation action; **Cancel** returns nothing.

The human must be able to:

- select options, write "Other", add a comment, and change their mind freely until confirmation;
- send one group's thread to the agent, or several prepared threads at once, and keep working while the agent answers;
- dismiss their own thread with a reason;
- confirm the batch once, with the preview, and see a "Decisions sent" end state that stays readable;
- reconnect: reloading the page or reopening the URL restores the local draft state; a server restart with the same session ID reconnects the open tab.

## Local safety

- Bind to loopback only; protect every endpoint and the WebSocket (or SSE) with a per-session key that is in the URL once and then in a cookie, as Reviewonator does.
- Validate every document from the agent and every payload from the UI with the shared schema.
- Serve only the image files explicitly listed in the current document; refuse everything else.
- Render agent-authored HTML mockups only inside a sandboxed iframe without scripts and without network access.
- Nothing leaves the machine: no telemetry, no external requests.
- Fail safely: a crashed agent process must not lose the human's draft; `wait` rerun after an interruption returns the unanswered request again.

## Distribution

This must be installable by other users, not tied to one machine.

Provide:

- the Decisionator application and CLI (`decisionator <SESSION_ID> --file <PATH> [--live] [--no-open] [--port <PORT>]`, `decisionator wait <SESSION_ID>`, `decisionator respond <SESSION_ID> --file <PATH>`, `--help`);
- one agent-neutral skill as project source, compatible with Claude Code and Codex, that teaches the agent **when** to open a decision screen (several related decisions; anything clearer shown than told; a design or screenshot round), **how** to write good groups (2–4 real options with trade-offs, one-sentence recommendation, mockups for layout questions, the assumptions list), the wait/respond loop, how to answer threads (direct answer first, revise the group when the discussion changes it, never drop a user message), and how to record confirmed answers in its own working notes;
- an installation script with a multi-select for Claude Code, Codex, or both, user-selected destinations, sensible defaults, prerequisite checks and clear errors;
- an uninstall script that removes only the files it installed (ownership markers);
- concise usage and verification instructions, and a short feature guide with screenshots.

Do not silently modify an unrelated existing skill or overwrite user files without confirmation.

## Engineering rules

- Follow Reviewonator's stack unless there is a concrete reason not to: Bun, TypeScript, Hono, Vite + React, Tailwind, zod, vitest, single-file web bundle compiled into the CLI binary.
- Design for testability from the start.
- Prefer the smallest practical implementation while keeping the code clean, readable, and maintainable.
- Use mature libraries for solved problems instead of reinventing them.
- All user-facing content and the entire application UI must be in English.
- Cover all application behavior with tests: schema validation, the wait/respond/confirm/cancel protocol end to end against a real local server, thread rules, draft persistence, the confirmation preview, mockup sandboxing, the file-serving allowlist, install and uninstall.
- Prefer tests of real behavior and real boundaries. Mock only when there is no practical alternative, never for convenience.
- Do not weaken tests to make the implementation pass.
- Preserve unrelated user changes in the working tree.

## Definition of done

The task is complete only when:

- the end-to-end agent → Decisionator → discussion rounds → confirm/cancel protocol works for both Claude Code and Codex with one shared skill and contract;
- no answer or comment reaches the agent before "Send to AI" or "Confirm", and the confirmation dialog shows exactly what is returned;
- every group supports a private thread with live agent replies in the same browser session, and only the human can dismiss a thread;
- mockups of all three kinds render safely in both themes at phone and desktop widths;
- version history across rounds works in one browser session;
- installation and uninstallation are tested;
- the full automated test suite, type checking, and production build pass;
- the final UI has been exercised in a real browser, including a multi-round discussion, a skipped group, an objection to an assumption, and the confirmation dialog;
- you provide exact commands for installing, running, testing, and uninstalling the result.

When finished, summarize the architecture, the protocol, important safety decisions, test coverage, and any genuine limitations. Do not claim completion for behavior you have not verified.

---

## Decisions made after this prompt

The repository deliberately differs from the task above in these points.

Decided by the project owner while the task was carried out:

- Agent-written content uses the decision language chosen at install time, like Reviewonator's review language; the interface stays in English.
- Common visuals are described in JSON so the agent does not have to write HTML: Mermaid diagrams, charts, tables, key figures, colour palettes, code, and diffs, next to screenshots and side-by-side views. Wireframes and mockups use sandboxed HTML.
- The interface is desktop-only and dark, like Reviewonator. HTML mockups still switch between light and dark, and side-by-side views stack when the space is narrow.
- A session ends when the human confirms or cancels, like Reviewonator. A later round is a new run with a new session ID; discussion rounds stay in one session and one browser tab.
- Communication follows Reviewonator exactly: the per-session key travels in the URL fragment and an `Authorization: Bearer` header, and as a `token` query parameter for the event stream and images, not in a cookie.

Implementation choices:

- The human's answers are returned in the `confirmed` result instead of being written back into the document. The interface derives each group's status, and documents that contain `status`, `accepted`, `objection`, or `answers` are rejected.
- Version history shows every earlier version of the screen with its mockups and discussions. It does not show earlier answers, because answers leave the browser only at confirmation.
- The server serves only images listed in a version of the current session, from snapshots taken when each version arrived, so the history shows the screenshots it was written with.
