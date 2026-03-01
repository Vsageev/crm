import type { ClassAttributes, HTMLAttributes, ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import type { ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import styles from './MarkdownContent.module.css';

interface MarkdownContentProps {
  children: string;
  /** Use compact sizing for comments and tight spaces */
  compact?: boolean;
  className?: string;
}

function CodeBlock({ className, children, ...props }: ClassAttributes<HTMLElement> & HTMLAttributes<HTMLElement> & ExtraProps) {
  const match = /language-(\w+)/.exec(className || '');
  const code = String(children).replace(/\n$/, '');
  if (match) {
    return (
      <SyntaxHighlighter style={oneDark} language={match[1]} PreTag="div">
        {code}
      </SyntaxHighlighter>
    );
  }
  return <code className={className} {...props}>{children}</code>;
}

export function MarkdownContent({ children, compact, className }: MarkdownContentProps) {
  const cls = [styles.markdown, compact && styles.compact, className].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code: CodeBlock }}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
