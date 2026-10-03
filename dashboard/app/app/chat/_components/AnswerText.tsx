// Renders an answer's light markdown (paragraphs, bullet and numbered lists,
// **bold**, ### headings) as React elements. No HTML is injected, so model
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

export function AnswerText({ text }: { text: string }) {
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return (
    <>
      {blocks.map((block, i) => {
        const lines = block.split('\n').filter((l) => l.trim());
        const lead = lines[0] && !BULLET.test(lines[0]) && !NUMBERED.test(lines[0]) ? lines[0] : null;
        const rest = lead ? lines.slice(1) : lines;
        const isList = rest.length > 0 && rest.every((l) => BULLET.test(l) || NUMBERED.test(l));
        if (isList) {
          const numbered = rest.every((l) => NUMBERED.test(l));
          const items = rest.map((l, k) => <li key={k}>{inline(l.replace(BULLET, '').replace(NUMBERED, ''))}</li>);
          return (
            <Fragment key={i}>
              {lead && <p className="my-2">{inline(lead.replace(/^#+\s*/, ''))}</p>}
              {numbered ? <ol className="my-2 list-decimal pl-5">{items}</ol> : <ul className="my-2 list-disc pl-5">{items}</ul>}
            </Fragment>
          );
        }
        if (lines.length === 1 && /^#{1,4}\s+/.test(lines[0])) {
          return <p key={i} className="my-2 font-semibold">{inline(lines[0].replace(/^#+\s*/, ''))}</p>;
        }
        return (
          <p key={i} className="my-2">
            {lines.map((l, k) => (
              <Fragment key={k}>
                {k > 0 && <br />}
                {inline(l)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </>
  );
}
