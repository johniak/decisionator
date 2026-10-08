# Security Policy

## Supported versions

Security fixes are provided for the latest published release and the current `main` branch. Older versions may not receive patches.

## Reporting a vulnerability

Do not report suspected vulnerabilities in a public issue, discussion, or pull request.

Use GitHub's **Report a vulnerability** option in the repository's Security tab. If private vulnerability reporting is unavailable, contact the maintainer privately using the contact information on the [maintainer's GitHub profile](https://github.com/johniak).

Please include:

- the affected version or commit;
- reproduction steps or a minimal proof of concept;
- the expected security impact;
- any suggested mitigation, if known.

You should receive an acknowledgement within seven days. Please allow time for a fix and coordinated disclosure before publishing details.

## Security model

Decisionator runs locally. Decision documents come from an AI agent and are treated as untrusted content.

- The server listens on `127.0.0.1` only and rejects requests addressed to any other host name.
- Every API endpoint, the event stream, and every screenshot require a per-session secret that is passed to the browser in the URL fragment and stored with owner-only permissions in the local state directory.
- Every document from the agent and every payload from the browser is validated with the shared schema. The agent cannot edit or drop the human's messages, dismiss a discussion, or answer a discussion it was not asked about.
- Nothing the human selects or types is sent to the agent before **Send to AI** or **Confirm**. Drafts stay in the browser's local storage.
- HTML mockups are sanitized with DOMPurify, rendered in an `<iframe sandbox="allow-same-origin">` without scripts, and carry a Content Security Policy that blocks every network request. The page itself uses a hash-based script policy, so inline event handlers cannot run even if sanitizing failed. Mermaid diagrams render with Mermaid's strict security level and are sanitized again before insertion. Markdown never renders raw HTML or remote images.
- Screenshots are read once when a document arrives, checked by their file signature, and served from memory by content hash. Decisionator never serves a file path, so nothing outside the images listed in the session's documents is reachable.
- Decisionator makes no external requests and sends no telemetry.

These protections were exercised in Chrome with hostile documents: scripts, event handlers, external images, stylesheets, frames, forms, refresh tags, links, and Mermaid click handlers produced no script execution and no request to the outside host.
