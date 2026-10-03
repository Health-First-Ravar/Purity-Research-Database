// Renders an answer's light markdown (paragraphs, bullet and numbered lists,
// **bold**, # headings) as React elements. No HTML is injected, so model
// output can never become markup.

import { Fragment, type ReactNode } from 'react';

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4
      ? <strong key={i}>{part.slice(2, -2)}</strong>
      : <Fragment key={i}>{part}</Fragment>,
  );
}

const BULLET = /^\s*[-*•]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;
const HEADING = /^\s*#{1,4}\s+/;

type Block = { kind: 'p' | 'h' | 'ul' | 'ol'; lines: string[] };

function blocks(text: string): Block[] {
  const out: Block[] = [];
  let cur: Block | null = null;
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) { cur = null; continue; }
    const kind: Block['kind'] = HEADING.test(line) ? 'h' : BULLET.test(line) ? 'ul' : NUMBERED.test(line) ? 'ol' : 'p';
    const text = kind === 'h' ? line.replace(HEADING, '') : kind === 'ul' ? line.replace(BULLET, '') : kind === 'ol' ? line.replace(NUMBERED, '') : line;
    if (cur && cur.kind === kind && kind !== 'h') cur.lines.push(text);
    else { cur = { kind, lines: [text] }; out.push(cur); }
  }
  return out;
}

export function AnswerText({ text }: { text: string }) {
  return (
    <>
      {blocks(text).map((b, i) => {
        if (b.kind === 'h') return <p key={i} className="my-2 font-semibold">{inline(b.lines[0])}</p>;
        if (b.kind === 'ul') return <ul key={i} className="my-2 list-disc pl-5">{b.lines.map((l, k) => <li key={k}>{inline(l)}</li>)}</ul>;
        if (b.kind === 'ol') return <ol key={i} className="my-2 list-decimal pl-5">{b.lines.map((l, k) => <li key={k}>{inline(l)}</li>)}</ol>;
        return (
          <p key={i} className="my-2">
            {b.lines.map((l, k) => <Fragment key={k}>{k > 0 && <br />}{inline(l)}</Fragment>)}
          </p>
        );
      })}
    </>
  );
}
