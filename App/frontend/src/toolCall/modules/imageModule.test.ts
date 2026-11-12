import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerateOperationVM } from '../ui/vmTypes';

const mocks = vi.hoisted(() => ({
  objects: new Map<string, unknown>(),
  useImageRun: vi.fn(),
}));

vi.mock('../../data/objects/objectCache', () => ({
  readAnyObjectFromCache: (id: string) => mocks.objects.get(id) ?? null,
}));
vi.mock('../../data/imageRuns', () => ({
  useImageRun: mocks.useImageRun,
  upsertImageRunInCache: vi.fn(),
}));
vi.mock('../../api/assetService', () => ({
  assetService: { decideImageRun: vi.fn() },
}));
vi.mock('../../components/common/AuthenticatedImage', () => ({
  default: (props: { src: string; alt: string }) => createElement('img', props),
}));
vi.mock('../../components/TextButton', () => ({
  TextButton: ({ children }: { children: ReactNode }) => createElement('button', null, children),
}));
vi.mock('../ui/FunctionCallCardShell', () => ({
  FunctionCallCardShell: ({ title, islands, defaultExpanded }: {
    title: string;
    islands: ReactNode[];
    defaultExpanded: boolean;
  }) => (
    createElement('section', { 'data-expanded': String(defaultExpanded) }, createElement('h2', null, title), ...islands)
  ),
}));

import imageModule from './imageModule';
import { ImageToolCard } from '../ui/cards/ImageToolCard';

function sceneOperation(args: Record<string, unknown> = {}): GenerateOperationVM {
  return imageModule.mapOperation({
    id: 'scene-call',
    toolName: 'generate_scene_image',
    status: 'pending',
    source: 'stored',
    args: {
      manuscript_id: 'manuscript-1',
      anchor: { before: 'The gate opened.', after: 'They stepped inside.' },
      prompt: 'A castle gate at dawn',
      ratio: '16:9',
      ...args,
    },
  }) as GenerateOperationVM;
}

function renderCard(operation: GenerateOperationVM): string {
  return renderToStaticMarkup(createElement(ImageToolCard, {
    threadId: 'thread-1',
    scopeKey: 'scope-1',
    projectId: 'project-1',
    operation,
    showDecisionButtons: true,
  }));
}

beforeEach(() => {
  mocks.objects.clear();
  mocks.useImageRun.mockReset();
  mocks.useImageRun.mockReturnValue(undefined);
});

describe('image tool display', () => {
  it.each([
    ['applied', 'Generated image applied successfully.'],
    ['rejected', 'Generated image was rejected by the user.'],
    ['canceled', 'Image generation was canceled.'],
  ])('shows the %s image result before the tool completion event arrives', (status, message) => {
    mocks.useImageRun.mockReturnValue({ status });

    const html = renderCard({ ...sceneOperation(), status: 'working' });

    expect(html).toContain(message);
    expect(html).not.toContain('Image workflow failed.');
  });

  it('maps both scene anchors and the chapter name from projected object data', () => {
    mocks.objects.set('manuscript-1', {
      id: 'manuscript-1',
      type: 'manuscript',
      metadata: { chapter_id: 'chapter-1' },
      data: { content: { type: 'doc', content: [] } },
    });
    mocks.objects.set('chapter-1', {
      id: 'chapter-1',
      type: 'outline',
      data: { name: '북문의 새벽', content: { type: 'doc', content: [] } },
    });

    const operation = sceneOperation();

    expect(operation.anchor).toEqual({ before: 'The gate opened.', after: 'They stepped inside.' });
    expect(operation.targetLabel).toBe('Manuscript: 북문의 새벽');
    expect(operation.title).toContain('북문의 새벽');
  });

  it.each([
    ['basic_info', { title: 'A Quiet Kingdom' }, 'A Quiet Kingdom'],
    ['story_entity', { name: 'The Gatekeeper' }, 'The Gatekeeper'],
  ])('reads a %s image target label from flat data', (type, data, label) => {
    mocks.objects.set('object-1', { id: 'object-1', type, data });

    const operation = imageModule.mapOperation({
      id: 'object-call',
      toolName: 'generate_object_image',
      status: 'pending',
      source: 'stored',
      args: { object_id: 'object-1', prompt: 'A portrait', ratio: '1:1' },
    });

    expect(operation.targetLabel).toBe(label);
  });

  it('shows both insertion contexts before generation has started', () => {
    const html = renderCard(sceneOperation());

    expect(html).toContain('The gate opened.');
    expect(html).toContain('They stepped inside.');
    expect(html).toContain('Before image');
    expect(html).toContain('After image');
    expect(html).not.toContain('[previous text]');
    expect(html).not.toContain('[following text]');
    expect(html.indexOf('The gate opened.')).toBeLessThan(html.indexOf('Preview not generated yet'));
    expect(html.indexOf('Preview not generated yet')).toBeLessThan(html.indexOf('They stepped inside.'));
    expect(html).toContain('A castle gate at dawn');
  });

  it('keeps the requested anchor pair visible when a generated preview exists', () => {
    mocks.useImageRun.mockReturnValue({
      before_excerpt: 'The wind died. The gate opened.',
      after_excerpt: 'They stepped inside. A bell rang.',
    });

    const html = renderCard(sceneOperation());

    expect(html).toContain('The gate opened.');
    expect(html).toContain('They stepped inside.');
    expect(html).not.toContain('The wind died.');
    expect(html).not.toContain('A bell rang.');
  });

  it.each(['collecting', 'streaming', 'validating'] as const)(
    'keeps a %s image request open and displays its current status', (status) => {
      const html = renderCard({ ...sceneOperation(), status });

      expect(html).toContain('data-expanded="true"');
      expect(html).toContain(status === 'validating' ? 'Validating image request...' : 'Receiving image request...');
      expect(html).not.toContain('Image workflow failed.');
      expect(html).toContain('The gate opened.');
      expect(html).toContain('They stepped inside.');
    },
  );

  it('shows separate positive and empty negative fields for positive/negative requests', () => {
    const operation = sceneOperation({ prompt: undefined, positive: 'A silver castle', negative: '' });

    const html = renderCard(operation);

    expect(operation.promptSections).toEqual([
      { label: 'Positive', text: 'A silver castle' },
      { label: 'Negative', text: '' },
    ]);
    expect(html).toContain('Positive');
    expect(html).toContain('Negative');
    expect(html).toContain('A silver castle');
    expect(html).toContain('(empty)');
    expect(html).not.toContain('Waiting for prompt...');
  });

  it('displays positive, negative, and ordered character prompts for NovelAI requests', () => {
    const operation = sceneOperation({
      prompt: undefined,
      positive: 'two travelers, castle gate, dawn',
      negative: 'blurry background',
      characters: [
        { positive: 'girl, red hair, raincoat', negative: 'hat' },
        { positive: 'boy, black hair, sailor uniform', negative: 'glasses' },
      ],
    });

    const html = renderCard(operation);

    expect(html).toContain('two travelers, castle gate, dawn');
    expect(html).toContain('blurry background');
    expect(html).toContain('girl, red hair, raincoat');
    expect(html).toContain('boy, black hair, sailor uniform');
    expect(html).toContain('hat');
    expect(html).toContain('glasses');
    expect(html).not.toContain('(empty prompt)');
    expect(html.indexOf('girl, red hair, raincoat')).toBeLessThan(html.indexOf('boy, black hair, sailor uniform'));
  });
});
