import React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import AuthenticatedImage from '../common/AuthenticatedImage';
import './MarkdownRenderer.css';

interface MarkdownRendererProps {
  children: string;
  className?: string;
}

const markdownRemarkPlugins = [remarkGfm, remarkBreaks];

const markdownComponents = {
  table: ({ node: _node, ...props }: React.ComponentProps<'table'> & { node?: unknown }) => (
    <div className="md-x-scroll md-x-scroll--table">
      <table {...props} />
    </div>
  ),
  img: ({ node: _node, ...props }: React.ComponentProps<typeof AuthenticatedImage> & { node?: unknown }) => (
    <AuthenticatedImage {...props} />
  ),
};

export const MarkdownRenderer = React.memo(function MarkdownRenderer({
  children,
  className = 'markdown-content',
}: MarkdownRendererProps) {
  return (
    <div className={className}>
      <Markdown
        remarkPlugins={markdownRemarkPlugins}
        components={markdownComponents}
      >
        {children}
      </Markdown>
    </div>
  );
});
