import React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

interface MarkdownRendererProps {
  children: string;
  className?: string;
}

export const MarkdownRenderer = React.memo(function MarkdownRenderer({
  children,
  className = 'markdown-content',
}: MarkdownRendererProps) {
  return (
    <div className={className}>
      <Markdown remarkPlugins={[remarkGfm, remarkBreaks]}>
        {children}
      </Markdown>
    </div>
  );
});
