/**
 * The site's serialized page data, and the escaping it uses in its attributes.
 *
 * The site puts its router payload in a `_ROUTER_DATA` script tag as JSON,
 * and the deferred loader calls in a `data-fn-args` attribute as HTML
 * escaped JSON. Both are read here, once, so every caller sees the same
 * shapes.
 */

/** The router payload of a page. */
export function extractRouter(html: string): any {
  const marker = html.indexOf("_ROUTER_DATA");
  if (marker < 0) throw new Error("页面没有内容数据");
  const first = html.indexOf("{", marker);
  if (first < 0) throw new Error("页面数据格式错误");
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = first; i < html.length; i++) {
    const ch = html[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') quoted = false;
      continue;
    }
    switch (ch) {
      case '"':
        quoted = true;
        break;
      case "{":
      case "[":
        depth++;
        break;
      case "}":
      case "]":
        depth--;
        if (depth === 0) return JSON.parse(html.substring(first, i + 1));
    }
  }
  throw new Error("页面数据不完整");
}

/** The escaping the site uses inside its attributes. */
export function unescapeHtml(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** The escaped slashes and ampersands the site puts in its urls. */
export function cleanUrl(value: string): string {
  return (value || "")
    .replace(/\\\//g, "/")
    .replace(/\\u002F/g, "/")
    .replace(/\\u0026/g, "&")
    .replace(/&amp;/g, "&");
}
