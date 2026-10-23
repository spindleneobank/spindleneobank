import { isValidElement, type ReactNode, useState } from 'react';
import ReactMarkdown from 'react-markdown';

function CopyButton({ value }: { value: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  return (
    <button
      type="button"
      className="chat-copy"
      aria-label="Copy code"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setState('ok');
        } catch {
          setState('fail');
        }
        setTimeout(() => setState('idle'), 1600);
      }}
    >
      {state === 'ok' ? 'Copied' : state === 'fail' ? 'Copy unavailable' : 'Copy'}
    </button>
  );
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const child = isValidElement<{ children?: ReactNode; className?: string }>(children) ? children : null;
  const text = typeof child?.props.children === 'string' ? child.props.children.replace(/\n$/, '') : '';
  const lang = child?.props.className?.replace(/^language-/, '') ?? 'text';
  return (
    <div className="chat-code">
      <div className="chat-code-head">
        <span>{lang}</span>
        <CopyButton value={text} />
      </div>
      <pre>{children}</pre>
    </div>
  );
}

export function Markdown({ children }: { children: string }) {
  return (
    <div className="chat-md">
      <ReactMarkdown
        skipHtml
        components={{
          pre: CodeBlock,
          a: ({ href, children: c }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {c}
            </a>
          ),
          img: () => <span>[image omitted]</span>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
