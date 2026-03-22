import type { ScenarioDocument } from '../../../types/scenarios';
import { extractFragmentReferences, validateTemplate } from '../../../templateEngine/engine';
import { generateTempId } from '../../../utils/tempId';
import { normalizeAgentName } from './SubAgentEditor';
import type { FragmentDraft, TemplateValidationResult } from './draftTypes';
import {
  DEFAULT_SUB_AGENT_ASSISTANT_TEMPLATE,
  DEFAULT_SUB_AGENT_SYSTEM_PROMPT,
  DEFAULT_SUB_AGENT_USER_PROMPT,
} from './subAgentDefaults';

export function getDraftFragmentFullPath(draft: Pick<FragmentDraft, 'folderPath' | 'fragmentName'>): string {
  const name = draft.fragmentName.trim();
  const folderPath = draft.folderPath.trim().replace(/^\/+|\/+$/g, '');
  if (!folderPath) return name;
  return name ? `${folderPath}/${name}` : folderPath;
}

export function getFragmentDraftLabel(draft: Pick<FragmentDraft, 'folderPath' | 'fragmentName'>): string {
  return getDraftFragmentFullPath(draft) || 'New Fragment';
}

export function isFragmentDraftDirty(
  draft: Pick<FragmentDraft, 'isNew' | 'content' | 'originalContent' | 'description' | 'originalDescription' | 'fragmentName' | 'sourceFragmentName'>
): boolean {
  if (draft.isNew) return true;
  return (
    draft.content !== draft.originalContent
    || draft.description !== draft.originalDescription
    || draft.fragmentName !== (draft.sourceFragmentName || '')
  );
}

export function getSubAgentScenarioLabel(displayName: string, agentName: string): string {
  const normalizedName = normalizeAgentName(agentName) || 'new_agent';
  const safeDisplayName = displayName.trim() || 'New';
  return `Sub Agent: ${safeDisplayName} / call_${normalizedName}`;
}

export function buildDefaultSubAgentScenario(): ScenarioDocument {
  return {
    system_template: DEFAULT_SUB_AGENT_SYSTEM_PROMPT,
    blocks: [
      {
        id: generateTempId(),
        block_order: 0,
        enabled: true,
        type: 'rangeMapping',
        rangeMapping: {
          start_index: 0,
          end_index: -1,
          user_template: DEFAULT_SUB_AGENT_USER_PROMPT,
          assistant_template: DEFAULT_SUB_AGENT_ASSISTANT_TEMPLATE,
        },
      },
    ],
  };
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}

export function toFragmentReference(path: string): string {
  const trimmed = path.trim();
  if (trimmed.startsWith('fragment:')) {
    return trimmed;
  }
  return `fragment:${trimmed.replace(/^\/+|\/+$/g, '')}`;
}

function detectCircularFragmentReferences(startPath: string, contentByPath: Map<string, string>): string[] | null {
  const visited = new Set<string>();
  const stack = new Set<string>();
  const path: string[] = [];

  const dfs = (current: string): string[] | null => {
    if (stack.has(current)) {
      return [...path, current];
    }
    if (visited.has(current)) return null;

    visited.add(current);
    stack.add(current);
    path.push(current);

    const content = contentByPath.get(current);
    if (content) {
      const refs = extractFragmentReferences(content);
      for (const ref of refs) {
        const cycle = dfs(ref);
        if (cycle) return cycle;
      }
    }

    stack.delete(current);
    path.pop();
    return null;
  };

  return dfs(startPath);
}

export async function validateFragmentContent(
  content: string,
  fullPath: string,
  fragmentDrafts: Record<string, FragmentDraft>,
  allFragmentContents: Map<string, string>,
): Promise<TemplateValidationResult> {
  const syntaxResult = await validateTemplate(content);
  if (!syntaxResult.isValid) {
    return {
      valid: false,
      errors: [
        {
          message: syntaxResult.error || 'Unknown syntax error',
          severity: 'error',
        },
      ],
      warnings: [],
    };
  }

  const contentByPath = new Map<string, string>();
  for (const [path, value] of allFragmentContents.entries()) {
    contentByPath.set(toFragmentReference(path), value);
  }
  for (const d of Object.values(fragmentDrafts)) {
    contentByPath.set(toFragmentReference(d.fullPath), d.content);
  }

  const refs = extractFragmentReferences(content);
  const warnings: TemplateValidationResult['warnings'] = [];
  const errors: TemplateValidationResult['errors'] = [];
  const currentRef = toFragmentReference(fullPath);

  for (const ref of refs) {
    if (!contentByPath.has(ref)) {
      warnings.push({ message: `Referenced fragment not found: "${ref}"`, severity: 'warning' });
    }
  }

  if (refs.includes(currentRef)) {
    errors.push({ message: `Self-reference detected: fragment "${currentRef}" references itself`, severity: 'error' });
  }

  const cycle = detectCircularFragmentReferences(currentRef, contentByPath);
  if (cycle) {
    errors.push({ message: `Circular reference detected: ${cycle.join(' -> ')}`, severity: 'error' });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
