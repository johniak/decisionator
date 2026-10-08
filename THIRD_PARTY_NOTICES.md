# Third-party notices

Decisionator includes open-source dependencies. Each dependency remains subject to its own license terms; this project does not replace or modify those terms.

Notable direct runtime dependencies include:

| Package | License | Project |
| --- | --- | --- |
| `@radix-ui/react-dialog` | MIT | <https://www.radix-ui.com/> |
| `clsx` | MIT | <https://github.com/lukeed/clsx> |
| `diff` | BSD-3-Clause | <https://github.com/kpdecker/jsdiff> |
| `dompurify` | MPL-2.0 or Apache-2.0 | <https://github.com/cure53/DOMPurify> |
| `hono` | MIT | <https://hono.dev/> |
| `lucide-react` | ISC, with icons derived from Feather under MIT | <https://lucide.dev/> |
| `mermaid` | MIT | <https://mermaid.js.org/> |
| `react` and `react-dom` | MIT | <https://react.dev/> |
| `react-markdown` | MIT | <https://github.com/remarkjs/react-markdown> |
| `recharts` | MIT | <https://recharts.org/> |
| `remark-gfm` | MIT | <https://github.com/remarkjs/remark-gfm> |
| `shiki` | MIT | <https://shiki.style/> |
| `zod` | MIT | <https://zod.dev/> |

Decisionator uses DOMPurify under the Apache License 2.0.

Binary release archives include the direct runtime dependencies' license texts in `third-party-licenses/`. Complete notices for transitive dependencies are available in each package's source distribution and installed package directory. The dependency versions used by a release are recorded in `bun.lock`.
