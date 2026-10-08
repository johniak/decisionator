# Decision document contract

Write UTF-8 JSON matching this shape. The example uses every mockup kind and a discussion thread; real screens usually need only a few of them.

```json
{
  "version": 1,
  "sessionId": "onboarding-plan-1",
  "language": "English",
  "title": "Onboarding redesign: decisions before the plan",
  "intro": "Four decisions shape the plan. Everything else follows the **assumptions** at the end.",
  "groups": [
    {
      "id": "layout",
      "title": "Where should the welcome checklist live?",
      "context": "The checklist is the first thing new users see. Moving it later costs a second migration of saved progress.",
      "mode": "single",
      "mockup": {
        "kind": "split",
        "leftLabel": "Today on desktop",
        "rightLabel": "Today on a phone",
        "left": { "kind": "image", "path": "/tmp/onboarding/desktop.png", "alt": "Current dashboard on desktop" },
        "right": { "kind": "image", "path": "/tmp/onboarding/phone.png", "alt": "Current dashboard on a phone", "width": 280 }
      },
      "options": [
        {
          "id": "sidebar",
          "label": "Sidebar panel",
          "description": "A collapsible panel next to the dashboard.",
          "pros": ["Always visible"],
          "cons": ["Takes width on small laptops"],
          "mockup": {
            "kind": "html",
            "theme": "light",
            "body": "<div class=\"dn-browser\"><div class=\"dn-row\" style=\"align-items:stretch\"><div class=\"dn-sidebar dn-stack\"><strong>Get started</strong><span class=\"dn-badge\">2 of 5 done</span></div><div class=\"dn-placeholder\" style=\"flex:1;margin:12px\">Dashboard</div></div></div>"
          }
        },
        {
          "id": "page",
          "label": "Dedicated page",
          "description": "A full page that users return to from the menu.",
          "recommended": true,
          "pros": ["Room for videos and help"],
          "cons": ["Easy to forget once dismissed"]
        }
      ],
      "recommendation": {
        "optionIds": ["page"],
        "text": "A dedicated page leaves room for the help videos marketing is producing."
      },
      "thread": {
        "messages": [
          { "id": "layout-u1", "author": "user", "body": "Can the page show progress in the menu?" },
          { "id": "layout-a1", "author": "agent", "body": "Yes. The menu item can show a small 2/5 badge until the checklist is complete." }
        ]
      }
    },
    {
      "id": "flow",
      "title": "When should we ask for the company name?",
      "context": "Asking early improves data quality but adds a step before the first value moment.",
      "mode": "single",
      "mockup": {
        "kind": "mermaid",
        "code": "flowchart LR\n  A[Sign up] --> B{Company name now?}\n  B -->|yes| C[Company step]\n  B -->|later| D[Dashboard]\n  C --> D"
      },
      "options": [
        { "id": "now", "label": "During sign-up", "description": "One extra field on the sign-up form." },
        { "id": "later", "label": "After the first project", "description": "Ask once the user has seen value." }
      ]
    },
    {
      "id": "plan",
      "title": "Which trial length should we test?",
      "context": "Conversion data from the last two experiments:",
      "mode": "single",
      "mockup": {
        "kind": "chart",
        "type": "line",
        "x": "week",
        "unit": "%",
        "series": [{ "key": "d14", "label": "14-day trial" }, { "key": "d30", "label": "30-day trial" }],
        "data": [
          { "week": "W1", "d14": 3.1, "d30": 2.4 },
          { "week": "W2", "d14": 4.0, "d30": 3.9 },
          { "week": "W3", "d14": 4.2, "d30": 4.8 }
        ]
      },
      "options": [
        {
          "id": "d14",
          "label": "14 days",
          "description": "Faster signal, lower conversion so far.",
          "mockup": {
            "kind": "stats",
            "items": [{ "label": "Conversion", "value": "4.2%", "detail": "after 3 weeks", "tone": "neutral" }]
          }
        },
        {
          "id": "d30",
          "label": "30 days",
          "description": "Slower signal, higher conversion so far.",
          "recommended": true,
          "mockup": {
            "kind": "table",
            "columns": ["Metric", "14 days", "30 days"],
            "rows": [["Conversion", "4.2%", "4.8%"], ["Support tickets", 31, 22], ["Card required", false, false]],
            "highlightColumn": 2
          }
        }
      ],
      "recommendation": { "optionIds": ["d30"], "text": "The 30-day trial converts better and halves early support tickets." }
    },
    {
      "id": "brand",
      "title": "Which accent colour should onboarding use?",
      "context": "Both pass 4.5:1 with white text.",
      "mode": "single",
      "options": [
        {
          "id": "teal",
          "label": "Teal",
          "description": "Matches the product.",
          "mockup": { "kind": "palette", "colors": [{ "name": "Accent", "value": "#127a8c", "usage": "Buttons" }] }
        },
        {
          "id": "violet",
          "label": "Violet",
          "description": "Matches the marketing site.",
          "mockup": { "kind": "palette", "colors": [{ "name": "Accent", "value": "#6d4ad8", "usage": "Buttons" }] }
        }
      ]
    },
    {
      "id": "api",
      "title": "How should the checklist API report progress?",
      "context": "The mobile app will cache this shape.",
      "mode": "single",
      "allowOther": true,
      "options": [
        {
          "id": "counts",
          "label": "Counts only",
          "description": "Smallest payload.",
          "mockup": { "kind": "code", "language": "json", "code": "{ \"done\": 2, \"total\": 5 }" }
        },
        {
          "id": "steps",
          "label": "Every step",
          "description": "Lets the app render the list offline.",
          "mockup": {
            "kind": "diff",
            "language": "ts",
            "filename": "src/onboarding/types.ts",
            "before": "export type Progress = { done: number; total: number };\n",
            "after": "export type Progress = { steps: { id: string; done: boolean }[] };\n"
          }
        }
      ]
    },
    {
      "id": "welcome",
      "title": "What should the welcome headline say?",
      "context": "Shown once, right after sign-up.",
      "mode": "text"
    }
  ],
  "assumptions": [
    { "id": "existing-users", "text": "Existing users do not see the new checklist." },
    { "id": "analytics", "text": "Every checklist step sends one analytics event." }
  ]
}
```

## Constraints

- `version` must be `1`. Unknown fields are rejected, so typos fail loudly instead of disappearing.
- `sessionId` must equal the session ID passed to the CLI. IDs start with a letter or digit and contain only letters, digits, dots, underscores, or hyphens.
- `language` must match the installed decision language configuration exactly. It cannot change during a live session.
- `intro`, `context`, option `description`, and assumption `text` are Markdown. Raw HTML in Markdown is shown as text, and Markdown images are shown as placeholders; use an `image` mockup for screenshots.
- `groups` contains 1–30 groups with unique IDs.
- `mode` is `single` (choose one), `multi` (choose any that apply), or `text` (write an answer).
- `single` and `multi` groups need 2–4 `options` with unique IDs. `text` groups have no options, no `allowOther`, and no recommendation.
- `allowOther: true` adds a free-text **Other** answer to a choice group.
- `recommendation` is optional. `optionIds` lists the recommended option (exactly one for `single`) and `text` is one sentence on one line. Set `recommended: true` on exactly those options and on no others. The recommendation is shown as a label; it is never pre-selected.
- `pros` and `cons` are optional lists of short, one-line trade-offs.
- `mockup` is optional on a group and on each option. See [mockups.md](mockups.md) for every kind.
- `thread` is the private discussion of one group. Messages alternate between `user` and `agent`, start with a `user` message, and keep stable unique IDs. A document you send may not end a thread with a user message, and only the human sets `dismissed` and `dismissalReason`. A user message can have `attachments`, the images the human sent with it; keep them exactly as they are and never add `attachments` to your own messages.
- `assumptions` lists what you will adopt unless the human objects. Each one needs a unique `id` and Markdown `text`.
- `versions` is managed by Decisionator: it lists the document versions of the session with the groups each one revised. You may leave it out or send it back unchanged; Decisionator ignores the value you send.
- Do not write `status`, `accepted`, `objection`, or `answers`. Decisionator derives group status in the UI and returns the human's answers in the confirmed result.

Decisionator validates the document, reads every image once, and refuses files that are missing, larger than 15 MB, or not PNG, JPEG, GIF, WebP, or SVG. Invalid documents must be corrected, not bypassed.

## Results returned by `decisionator wait`

A **discussion** request contains only the threads the human sent with **Send to AI**, never their selections or comments. A message can carry the images the human attached:

```text
{
  "status": "discussion",
  "sessionId": "onboarding-plan-1",
  "documentVersion": 1,
  "groupIds": ["layout"],
  "messages": [{
    "groupId": "layout",
    "messageId": "u-…",
    "body": "Could the panel start collapsed? It covers the total here.",
    "attachments": [{ "path": "/Users/me/.local/state/decisionator/onboarding-plan-1/attachments/3f…9a.png", "type": "image/png", "name": "Screenshot 2026-10-08 at 13.12.png" }]
  }],
  "document": { …the authoritative document, already containing that message and its attachments… }
}
```

A **confirmed** result contains every answer:

```json
{
  "status": "confirmed",
  "sessionId": "onboarding-plan-1",
  "documentVersion": 2,
  "answers": {
    "groups": [
      {
        "groupId": "layout",
        "title": "Where should the welcome checklist live?",
        "mode": "single",
        "status": "skipped",
        "selectedOptionIds": ["page"],
        "selectedOptionLabels": ["Dedicated page"],
        "otherText": null,
        "text": null,
        "comment": "Show the badge only until day 7.",
        "skippedUsingRecommendation": true,
        "attachments": [
          {
            "field": "comment",
            "path": "/Users/me/.local/state/decisionator/onboarding-plan-1/attachments/9c41e5d2a8f0b7e6c3d1a4f5b2e8c9d0a7b6e5f4c3d2b1a0f9e8d7c6b5a4f3e2.png",
            "type": "image/png",
            "name": "badge-on-day-7.png"
          }
        ],
        "thread": {
          "messages": [
            { "id": "layout-u1", "author": "user", "body": "Can the page show progress in the menu?" },
            { "id": "layout-a1", "author": "agent", "body": "Yes. The menu item can show a small 2/5 badge until the checklist is complete." }
          ],
          "dismissed": true,
          "dismissalReason": "Answered."
        }
      }
    ],
    "assumptions": [
      { "id": "existing-users", "text": "Existing users do not see the new checklist.", "accepted": false, "objection": "Show it to users created this month." }
    ],
    "globalComment": "Keep the plan under a week.",
    "globalAttachments": []
  }
}
```

- `status` is `answered` or `skipped`. A skipped group with a recommendation returns the recommended options in `selectedOptionIds` and `skippedUsingRecommendation: true`; record it as "adopted the recommendation by skipping". A skipped group without a recommendation returns no options and `skippedUsingRecommendation: false`; record it as "no decision, ask again".
- `otherText` holds a free **Other** answer, `text` holds the answer to a `text` group, and `comment` holds the human's comment for that group. Each is `null` when empty.
- `attachments` lists the images the human attached to this group. `field` is `text` or `otherText` when the image is (part of) that answer, and `comment` when it belongs to the comment. An image can be the whole answer, so `text` or `otherText` may be `null` while an image with that field exists. `globalAttachments` lists the images attached to the final comment. Open every image at its `path`; the files are PNG, JPEG, GIF, or WebP.
- `thread` is the full discussion, including the human's dismissal and reason.
- Every assumption is listed. `accepted: false` comes with the human's `objection`.

A **cancelled** result is `{ "status": "cancelled", "sessionId": "…" }`. Treat it as "no decisions were made".

## Live discussion rounds

`decisionator wait <SESSION_ID>` returns one request at a time. Use its `document` as the base for your response; do not rebuild the threads yourself.

Submit the updated document with `decisionator respond <SESSION_ID> --file <PATH>`. Decisionator rejects a response that:

- changes `sessionId` or `language`;
- edits, removes, or reorders an existing message;
- does not add exactly one `agent` message to each group listed in `groupIds`;
- adds messages to any other group or starts a thread on a new group;
- sets `dismissed` or `dismissalReason`;
- adds `attachments` to an agent message, or changes the `attachments` of a user message;
- removes a group that has a discussion.

Everything else may change: you can revise options, mockups, recommendations, context, assumptions, and the intro, and you can add or remove groups nobody discussed. The browser receives the accepted document as a new version, highlights every revised group, keeps the human's draft for options that still exist, and lets them read earlier versions. If the agent process is interrupted, `decisionator wait` returns the unanswered request again.
