import { parseMarkdown, type Inline } from "@/lib/markdown";

function Inl({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case "text": return <span key={i}>{n.v}</span>;
          case "code": return <code key={i} dir="ltr" className="icode">{n.v}</code>;
          case "strong": return <strong key={i}><Inl nodes={n.c} /></strong>;
          case "em": return <em key={i}><Inl nodes={n.c} /></em>;
          case "link": return <a key={i} href={n.href} target="_blank" rel="noopener noreferrer nofollow"><Inl nodes={n.c} /></a>;
        }
      })}
    </>
  );
}

/** Restricted Markdown renderer. Content is never translated; each block isolates its own direction. */
export function Markdown({ source }: { source: string }) {
  const blocks = parseMarkdown(source);
  return (
    <div className="prose" data-testid="text-lesson-body">
      {blocks.map((b, i) => {
        if (b.t === "h") {
          const Tag = (`h${b.level}`) as "h2" | "h3" | "h4" | "h5";
          return <Tag key={i} dir="auto"><Inl nodes={b.c} /></Tag>;
        }
        if (b.t === "p") return <p key={i} dir="auto"><Inl nodes={b.c} /></p>;
        if (b.t === "code") return <pre key={i} dir="ltr" data-lang={b.lang || undefined}><code>{b.v}</code></pre>;
        const List = b.t;
        return <List key={i} dir="auto">{b.items.map((it, j) => <li key={j}><Inl nodes={it} /></li>)}</List>;
      })}
    </div>
  );
}
