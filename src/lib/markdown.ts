import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";
import { marked } from "marked";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    code({ text, lang }) {
      const l = (lang ?? "").split(/\s/)[0];
      const html = l && hljs.getLanguage(l) ? hljs.highlight(text, { language: l }).value : esc(text);
      return `<div class="codeblock"><button type="button" class="copy-btn">Copy</button><pre><code class="hljs${l ? ` language-${esc(l)}` : ""}">${html}</code></pre></div>`;
    },
    html({ text }) {
      return esc(text); // raw HTML in messages is shown as text, never executed
    },
  },
});

let hooked = false;
/** Render untrusted markdown to sanitized HTML (FR-51). Client-side only (needs a DOM). */
export function renderMarkdown(src: string): string {
  if (!hooked) {
    hooked = true;
    DOMPurify.addHook("afterSanitizeAttributes", (node) => {
      if (node.tagName === "A") {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer nofollow");
      }
    });
  }
  const html = marked.parse(src, { async: false }) as string;
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ["style", "form", "input", "iframe", "object", "embed", "script", "svg", "math"],
    FORBID_ATTR: ["style", "srcset"],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  });
}
