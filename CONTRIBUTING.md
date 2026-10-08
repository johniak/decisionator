# Contributing to Decisionator

Thank you for helping improve Decisionator. Small, focused changes with clear tests are the easiest to review and maintain.

## Before you start

- Search existing issues and pull requests to avoid duplicate work.
- Open an issue before a large feature or architectural change so the approach can be discussed first.
- Report security vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
- Follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Development setup

You need Bun 1.3.13 or a compatible newer version and Node.js 20 or newer for the test runner.

```sh
git clone https://github.com/johniak/decisionator.git
cd decisionator
bun install --frozen-lockfile
bun run check
```

Open the example decision screen with:

```sh
bun run demo
```

## Project expectations

- Keep all application UI and user-facing copy in English. Agent-authored decision content keeps the configured language.
- Design behavior for testability from the start.
- Prefer established libraries for solved problems.
- Keep implementations small, readable, and maintainable.
- Cover every behavior change with tests.
- Exercise real behavior and integrations where practical. Mock only when there is no reasonable alternative.
- Preserve the human decision boundary: nothing the human selects or types may reach the agent before **Send to AI** or **Confirm**, and only the human confirms, skips, cancels, or dismisses.
- Keep agent-authored content sandboxed: no scripts, no network requests, and no files outside the ones a document lists.

## Pull requests

Before opening a pull request:

```sh
bun run check
```

Your pull request should explain the problem, the chosen solution, and how it was tested. Include screenshots or a short recording for visible UI changes. Keep unrelated refactors out of the same pull request.

By contributing, you agree that your contribution is licensed under the project's MIT License.
