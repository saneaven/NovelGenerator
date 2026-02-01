import React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import './MarkdownRenderer.css';

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
      <Markdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          table: ({ node, ...props }) => (
            <div className="md-x-scroll md-x-scroll--table">
              <table {...props} />
            </div>
          ),
        }}
      >
        {children}
      </Markdown>
    </div>
  );
});
