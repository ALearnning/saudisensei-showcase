// Restricted Markdown: headings, paragraphs, lists, inline code, fenced code, emphasis, safe links.
// Raw HTML is skipped, images render as plain alt text, unsafe link protocols render as text.
export type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "strong"; c: Inline[] }
  | { t: "em"; c: Inline[] }
  | { t: "link"; href: string; c: Inline[] };
export type Block =
  | { t: "h"; level: 2 | 3 | 4 | 5; c: Inline[] }
  | { t: "p"; c: Inline[] }
  | { t: "ul" | "ol"; items: Inline[][] }
  | { t: "code"; lang: string; v: string };

const HTML_TAG = /<\/?[A-Za-z][^>]*>|<!--[\s\S]*?-->/g;

export function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (/^(https?:\/\/|mailto:)/i.test(href) && !/[\s<>"']/.test(href)) return href;
  return null;
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const flush = () => { if (text) { out.push({ t: "text", v: text }); text = ""; } };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i) { flush(); out.push({ t: "code", v: src.slice(i + 1, end) }); i = end + 1; continue; }
    }
    if (ch === "<") {
      HTML_TAG.lastIndex = 0;
      const m = HTML_TAG.exec(src.slice(i));
      if (m && m.index === 0) { i += m[0].length; continue; }
    }
    if (ch === "!" && src[i + 1] === "[") {
      const m = /^!\[([^\]]*)\]\(([^)]*)\)/.exec(src.slice(i));
      if (m) { text += m[1]; i += m[0].length; continue; }
    }
    if (ch === "[") {
      const m = /^\[([^\]]+)\]\(([^)]*)\)/.exec(src.slice(i));
      if (m) {
        const href = safeHref(m[2]);
        if (href) { flush(); out.push({ t: "link", href, c: parseInline(m[1]) }); }
        else text += m[1];
        i += m[0].length;
        continue;
      }
    }
    if ((ch === "*" || ch === "_") && src[i + 1] === ch) {
      const end = src.indexOf(ch + ch, i + 2);
      if (end > i + 2) { flush(); out.push({ t: "strong", c: parseInline(src.slice(i + 2, end)) }); i = end + 2; continue; }
    }
    if (ch === "*" || ch === "_") {
      const end = src.indexOf(ch, i + 1);
      if (end > i + 1 && src[i + 1] !== " ") { flush(); out.push({ t: "em", c: parseInline(src.slice(i + 1, end)) }); i = end + 1; continue; }
    }
    text += ch;
    i++;
  }
  flush();
  return out;
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flushPara = () => { if (para.length) { blocks.push({ t: "p", c: parseInline(para.join(" ")) }); para = []; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^\s*(```|~~~)\s*([A-Za-z0-9_+-]*)\s*$/.exec(line);
    if (fence) {
      flushPara();
      const body: string[] = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s*${fence[1]}\\s*$`).test(lines[i])) { body.push(lines[i]); i++; }
      blocks.push({ t: "code", lang: fence[2], v: body.join("\n") });
      continue;
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      flushPara();
      const level = Math.min(5, h[1].length + 1) as 2 | 3 | 4 | 5;
      blocks.push({ t: "h", level, c: parseInline(h[2]) });
      continue;
    }
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ol = /^\s*\d{1,9}[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      flushPara();
      const kind = ul ? "ul" : "ol";
      const re = ul ? /^\s*[-*+]\s+(.*)$/ : /^\s*\d{1,9}[.)]\s+(.*)$/;
      const items: Inline[][] = [];
      while (i < lines.length) {
        const m = re.exec(lines[i]);
        if (!m) break;
        items.push(parseInline(m[1]));
        i++;
      }
      i--;
      blocks.push({ t: kind, items });
      continue;
    }
    if (line.trim() === "") { flushPara(); continue; }
    if (/^\s*<\/?[A-Za-z][^>]*>\s*$/.test(line)) continue; // skip raw HTML lines
    para.push(line.trim());
  }
  flushPara();
  return blocks;
}
