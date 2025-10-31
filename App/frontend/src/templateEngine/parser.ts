import type {
  ConditionalNode,
  ParseResult,
  PlaceholderNode,
  TemplateDiagnostic,
  TemplateNode,
  TextNode,
} from './types';

interface ParserState {
  index: number;
  content: string;
  diagnostics: TemplateDiagnostic[];
}

interface ParseChildrenResult {
  nodes: TemplateNode[];
  terminated: boolean;
}

let parserContentCache = '';

export function parseTemplate(content: string): ParseResult {
  parserContentCache = content;
  const state: ParserState = {
    index: 0,
    content,
    diagnostics: [],
  };

  const { nodes } = parseChildren(state, false);

  return {
    nodes,
    diagnostics: state.diagnostics,
  };
}

function parseChildren(state: ParserState, stopOnClose: boolean): ParseChildrenResult {
  const nodes: TemplateNode[] = [];
  const { content } = state;

  while (state.index < content.length) {
    const nextOpen = content.indexOf('{{', state.index);

    if (nextOpen === -1) {
      // Remaining text
      nodes.push(createTextNode(content.substring(state.index), state.index, content.length));
      state.index = content.length;
      break;
    }

    if (nextOpen > state.index) {
      // Text before tag
      nodes.push(createTextNode(content.substring(state.index, nextOpen), state.index, nextOpen));
      state.index = nextOpen;
    }

    // Now at '{{'
    const closeIndex = content.indexOf('}}', state.index + 2);
    if (closeIndex === -1) {
      state.diagnostics.push(createDiagnostic('error', 'Incomplete template tag (missing closing braces).', state.index));
      // consume rest as text and stop
      nodes.push(createTextNode(content.substring(state.index), state.index, content.length));
      state.index = content.length;
      break;
    }

    const rawTag = content.substring(state.index, closeIndex + 2);
    const tagContent = content.substring(state.index + 2, closeIndex);
    const tagStart = state.index;
    const tagEnd = closeIndex + 2;
    state.index = tagEnd;

    if (tagContent.startsWith('#if::')) {
      const conditionalNode = parseConditional(state, tagContent, tagStart, tagEnd);
      nodes.push(conditionalNode);
      continue;
    }

    if (tagContent === '/if') {
      if (stopOnClose) {
        return { nodes, terminated: true };
      }

      state.diagnostics.push(createDiagnostic('error', 'Closing {{/if}} without a matching opening {{#if::...}}.', tagStart));
      continue;
    }

    const placeholderNode = parsePlaceholder(tagContent, rawTag, tagStart, tagEnd);
    if (placeholderNode) {
      nodes.push(placeholderNode);
    } else {
      state.diagnostics.push(createDiagnostic('error', `Malformed template tag: ${rawTag}`, tagStart));
    }
  }

  return { nodes, terminated: false };
}

function parseConditional(state: ParserState, tagContent: string, start: number, end: number): ConditionalNode {
  const conditionBody = tagContent.slice('#if::'.length);
  let negated = false;
  let name = conditionBody.trim();

  if (name.startsWith('!')) {
    negated = true;
    name = name.slice(1);
  }

  if (!name || !/^[a-zA-Z0-9_.-]+$/.test(name)) {
    state.diagnostics.push(createDiagnostic('error', `Malformed conditional tag: {{#if::${conditionBody}}}`, start));
  }

  const childrenResult = parseChildren(state, true);

  if (!childrenResult.terminated) {
    state.diagnostics.push(createDiagnostic('error', `Unclosed conditional block {{#if::${conditionBody}}}. Missing {{/if}}.`, start));
  }

  const conditionalNode: ConditionalNode = {
    type: 'conditional',
    name,
    negated,
    children: childrenResult.nodes,
    start,
    end,
  };

  return conditionalNode;
}

function parsePlaceholder(tagContent: string, rawTag: string, start: number, end: number): PlaceholderNode | null {
  const separatorIndex = tagContent.indexOf('::');
  if (separatorIndex === -1) {
    return null;
  }

  const prefix = tagContent.substring(0, separatorIndex).trim();
  const name = tagContent.substring(separatorIndex + 2).trim();

  if (!name || !/^[a-zA-Z0-9_.-]+$/.test(name)) {
    return null;
  }

  if (prefix === 'var') {
    return {
      type: 'placeholder',
      placeholderType: 'variable',
      name,
      raw: rawTag,
      start,
      end,
    };
  }

  if (prefix === 'context') {
    return {
      type: 'placeholder',
      placeholderType: 'context',
      name,
      raw: rawTag,
      start,
      end,
    };
  }

  return null;
}

function createTextNode(value: string, start: number, end: number): TextNode {
  return {
    type: 'text',
    value,
    start,
    end,
  };
}

function createDiagnostic(level: 'error' | 'warning', message: string, index: number): TemplateDiagnostic {
  return {
    level,
    message,
    ...positionFromIndex(index),
  };
}

function positionFromIndex(index: number): { line: number; column: number } {
  const contentBefore = parserContentCache.substring(0, index);
  const lines = contentBefore.split('\n');
  const line = lines.length;
  const column = lines[lines.length - 1]?.length ?? 0;
  return { line, column };
}
