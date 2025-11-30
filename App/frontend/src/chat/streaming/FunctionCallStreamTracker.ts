import { Allow, parse } from 'partial-json';
import type {
  FunctionCallDraft,
  FunctionCallOperationPreview,
  FunctionCallProgress,
  FunctionCallProgressStatus,
} from '../../llm_request/types';
import type { FunctionCallSchema } from '../types/functionCalling';
import { buildPreviewFromOperation } from '../utils/functionCallPreview';

type ToolCallDelta = {
  index?: number;
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
};

interface DraftState {
  draft: FunctionCallDraft;
  status: FunctionCallProgressStatus;
  error?: string;
  updatedAt: number;
  operationPreviews: FunctionCallOperationPreview[];
}

export class FunctionCallStreamTracker {
  private drafts = new Map<number, DraftState>();
  private schemaByName: Record<string, FunctionCallSchema> = {};

  constructor(functionSchemas?: FunctionCallSchema[]) {
    if (functionSchemas) {
      for (const schema of functionSchemas) {
        this.schemaByName[schema.name] = schema;
      }
    }
  }

  applyDelta(deltas?: ToolCallDelta[] | null): FunctionCallProgress[] {
    if (!deltas || deltas.length === 0) {
      return [];
    }

    const events: FunctionCallProgress[] = [];
    deltas.forEach((delta, position) => {
      const index = this.resolveIndex(delta, position);
      const state = this.ensureDraft(index);

      if (delta.id) {
        state.draft.id = delta.id;
      }

      if (delta.function?.name) {
        state.draft.functionName = delta.function.name;
      }

      if (delta.function?.arguments) {
        const chunk = delta.function.arguments;
        state.draft.rawArguments += chunk;
        state.draft.segments.push(chunk);
        state.updatedAt = Date.now();
        this.parseArguments(state);
      } else if (delta.function?.name) {
        // Name arrived without arguments yet - still emit progress so UI can show upcoming call.
        state.updatedAt = Date.now();
        state.status = 'collecting';
      }

      events.push(this.toProgress(state));
    });

    return events;
  }

  finalize(): any[] {
    return Array.from(this.drafts.values()).map((state) => ({
      id: state.draft.id,
      type: 'function',
      function: {
        name: state.draft.functionName,
        arguments: state.draft.rawArguments,
      },
    }));
  }

  private resolveIndex(delta: ToolCallDelta, fallbackPosition: number): number {
    if (typeof delta.index === 'number') {
      return delta.index;
    }

    if (delta.id) {
      for (const [idx, state] of this.drafts.entries()) {
        if (state.draft.id === delta.id) {
          return idx;
        }
      }
      // New ID we haven't seen before: assign a fresh slot so it doesn't collide
      return this.drafts.size;
    }

    return fallbackPosition;
  }

  private ensureDraft(index: number): DraftState {
    if (!this.drafts.has(index)) {
      const now = Date.now();
      this.drafts.set(index, {
        draft: {
          id: `tool-call-${index}`,
          index,
          functionName: '',
          rawArguments: '',
          parsedArguments: null,
          segments: [],
        },
        status: 'collecting',
        updatedAt: now,
        operationPreviews: [],
      });
    }

    return this.drafts.get(index)!;
  }

  private parseArguments(state: DraftState): void {
    const raw = state.draft.rawArguments;
    try {
      if (raw.trim()) {
        const parsed = parse(raw, Allow.ALL);
        state.draft.parsedArguments = parsed;
      }
      state.error = undefined;
      const coverage = this.computeCoverage(state);
      state.status = coverage >= 0.98 ? 'ready' : 'validating';
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
      state.status = 'collecting';
    } finally {
      state.operationPreviews = this.buildOperationPreviews(state);
    }
  }

  private computeCoverage(state: DraftState): number {
    const args = state.draft.parsedArguments;
    if (!args) {
      return 0;
    }

    const schema = this.schemaByName[state.draft.functionName];
    if (!schema) {
      return 1;
    }

    return this.computeSchemaCoverage(schema.parameters, args);
  }

  private computeSchemaCoverage(schema: any, value: any): number {
    if (!schema) {
      return value ? 1 : 0;
    }

    const required: string[] = Array.isArray(schema.required) ? schema.required : [];
    const properties = schema.properties || {};

    if (!required.length) {
      if (schema.type === 'array' && Array.isArray(value) && schema.items) {
        if (value.length === 0) {
          return 0.5;
        }
        const perItem = value.reduce((acc: number, item: any) => acc + this.computeSchemaCoverage(schema.items, item), 0);
        return Math.min(1, perItem / value.length);
      }

      if (schema.type === 'object' && typeof value === 'object' && value !== null) {
        const keys = Object.keys(properties);
        if (!keys.length) {
          return 1;
        }
        const perKey = keys.reduce((acc, key) => acc + this.computeSchemaCoverage(properties[key], value[key]), 0);
        return Math.min(1, perKey / keys.length);
      }

      return value !== undefined && value !== null ? 1 : 0;
    }

    let covered = 0;
    required.forEach((key) => {
      if (!(key in value)) {
        return;
      }

      const propSchema = properties[key];
      const childValue = value[key];

      if (propSchema?.type === 'array') {
        if (Array.isArray(childValue) && childValue.length > 0) {
          const sum = childValue.reduce((acc: number, item: any) => acc + this.computeSchemaCoverage(propSchema.items, item), 0);
          covered += Math.min(1, sum / childValue.length);
        }
      } else if (propSchema?.type === 'object') {
        covered += this.computeSchemaCoverage(propSchema, childValue);
      } else if (childValue !== undefined && childValue !== null && childValue !== '') {
        covered += 1;
      }
    });

    return required.length ? Math.min(1, covered / required.length) : 1;
  }

  private toProgress(state: DraftState): FunctionCallProgress {
    return {
      draft: state.draft,
      status: state.status,
      preview: state.draft.parsedArguments || undefined,
      rawPreview: this.buildRawPreview(state),
      operationPreviews: state.operationPreviews,
      error: state.error,
      updatedAt: state.updatedAt,
    };
  }

  private buildRawPreview(state: DraftState): string {
    if (state.draft.parsedArguments) {
      try {
        return JSON.stringify(state.draft.parsedArguments, null, 2);
      } catch {
        // Fall through to raw text
      }
    }

    if (state.draft.segments.length > 0) {
      const joined = state.draft.segments.join('');
      return joined || '';
    }

    return '';
  }

  private buildOperationPreviews(state: DraftState): FunctionCallOperationPreview[] {
    if (!state.draft.rawArguments.trim()) {
      return [];
    }

    if (!state.error && state.draft.parsedArguments) {
      return this.buildParsedOperationPreviews(state);
    }

    return this.buildFallbackOperationPreviews(state);
  }

  private buildParsedOperationPreviews(state: DraftState): FunctionCallOperationPreview[] {
    const args = state.draft.parsedArguments;
    if (!args) {
      return [];
    }

    const schema = this.schemaByName[state.draft.functionName];
    const operationsSchema = schema?.parameters?.properties?.operations?.items;

    if (Array.isArray(args.operations)) {
      return args.operations.map((operation: any, index: number) =>
        buildPreviewFromOperation(operation, index, operationsSchema)
      );
    }

    return [buildPreviewFromOperation(args, 0, schema?.parameters)];
  }

  private buildFallbackOperationPreviews(state: DraftState): FunctionCallOperationPreview[] {
    const raw = state.draft.rawArguments;
    if (!raw.trim()) {
      return [];
    }

    const matches = Array.from(raw.matchAll(/"action"\s*:\s*"([^"]+)"/g));
    if (!matches.length) {
      return [
        {
          key: 'raw',
          rawSnippet: this.truncate(raw, 400),
        },
      ];
    }

    return matches.map((match, index) => {
      const start = Math.max(0, (match.index ?? 0) - 80);
      const end = Math.min(raw.length, (match.index ?? 0) + 220);
      const slice = raw.slice(start, end);
      const typeMatch = slice.match(/"type"\s*:\s*"([^"]+)"/);
      const idMatch = slice.match(/"id"\s*:\s*"([^"]+)"/);
      return {
        key: `raw-${index}`,
        action: match[1],
        type: typeMatch?.[1],
        id: idMatch?.[1],
        rawSnippet: this.truncate(slice, 360),
      };
    });
  }

  private truncate(value: string, limit: number): string {
    if (value.length <= limit) {
      return value;
    }
    return `${value.slice(0, limit)}…`;
  }
}
