import React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

interface MarkdownRendererProps {
  children: string;
  className?: string;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  children,
  className = 'markdown-content'
}) => {
  return (
    <div className={className}>
      <Markdown remarkPlugins={[remarkGfm, remarkBreaks]}>
        {children}
      </Markdown>
    </div>
  );
};
