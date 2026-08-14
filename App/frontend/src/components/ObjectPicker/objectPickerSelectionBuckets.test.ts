import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

describe('persisted ObjectPicker bucket usage', () => {
  it.each([
    ['AgentPanel', '../../pages/workspace/components/AgentPanel.tsx', 'agent-context'],
    ['AIEditModal', '../Modal/AIEditModal.tsx', 'ai-edit-context'],
    ['UnifiedImagePromptModal', '../ImageGeneration/UnifiedImagePromptModal.tsx', 'image-prompt-context'],
  ])('%s uses its purpose-specific context bucket', (_name, path, bucket) => {
    const source = readSource(path);

    expect(source).toContain(`bucket: '${bucket}'`);
    expect(source).not.toContain("bucket: 'all-context'");
  });

  it('keeps translation targets and context in separate buckets', () => {
    const source = readSource('../Modal/TranslationModal.tsx');

    expect(source).toContain("bucket: 'translation-target'");
    expect(source).toContain("bucket: 'translation-context'");
  });
});
