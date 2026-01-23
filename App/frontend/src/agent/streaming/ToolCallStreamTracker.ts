import { Allow, parse } from 'partial-json';
import type {
  ToolCallDraft,
  ToolCallProgress,
  ToolCallProgressStatus,
} from '../../llm/requestTypes';

type ToolCallDelta = {
  index?: number;
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
};

type JsonObjectStreamState = {
  started: boolean;
  depth: number;
  inString: boolean;
  escape: boolean;
  completed: boolean;
};

function createJsonObjectStreamState(): JsonObjectStreamState {
  return {
    started: false,
    depth: 0,
    inString: false,
    escape: false,
    completed: false,
  };
}

function advanceJsonObjectStreamState(state: JsonObjectStreamState, text: string): void {
  if (state.completed || !text) {
    return;
  }

  for (const ch of text) {
    if (!state.started) {
      if (ch === '{') {
        state.started = true;
        state.depth = 1;
      }
      continue;
    }

    if (state.inString) {
      if (state.escape) {
        state.escape = false;
        continue;
      }
      if (ch === '\\') {
        state.escape = true;
        continue;
      }
      if (ch === '"') {
        state.inString = false;
      }
      continue;
    }

    if (ch === '"') {
      state.inString = true;
      continue;
    }

    if (ch === '{') {
      state.depth += 1;
      continue;
    }

    if (ch === '}') {
      state.depth -= 1;
      if (state.depth === 0) {
        state.completed = true;
        return;
      }
    }
  }
}

interface DraftState {
  draft: ToolCallDraft;
  status: ToolCallProgressStatus;
  error?: string;
  updatedAt: number;
  jsonState: JsonObjectStreamState;
}

export class ToolCallStreamTracker {
  private drafts = new Map<number, DraftState>();

  applyDelta(deltas?: ToolCallDelta[] | null): ToolCallProgress[] {
    if (!deltas || deltas.length === 0) {
      return [];
    }

    const events: ToolCallProgress[] = [];
    deltas.forEach((delta, position) => {
      const index = this.resolveIndex(delta, position);
      const state = this.ensureDraft(index);

      if (delta.id) {
        state.draft.id = delta.id;
      }

      if (delta.function?.name) {
        state.draft.toolName = delta.function.name;
      }

      if (delta.function?.arguments) {
        const chunk = delta.function.arguments;
        state.draft.rawArguments += chunk;
        advanceJsonObjectStreamState(state.jsonState, chunk);
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
        name: state.draft.toolName,
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
          toolName: '',
          rawArguments: '',
          parsedArguments: null,
        },
        status: 'collecting',
        updatedAt: now,
        jsonState: createJsonObjectStreamState(),
      });
    }

    return this.drafts.get(index)!;
  }

  private parseArguments(state: DraftState): void {
    const raw = state.draft.rawArguments;
    try {
      if (!raw.trim()) {
        state.draft.parsedArguments = null;
        state.error = undefined;
        state.status = 'collecting';
        return;
      }

      state.draft.parsedArguments = parse(raw, Allow.ALL);
      state.error = undefined;

      if (state.jsonState.completed) {
        state.draft.parsedArguments = JSON.parse(raw);
        state.status = 'ready';
      } else {
        state.status = 'validating';
      }
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
      state.draft.parsedArguments = null;
      state.status = 'error';
    }
  }

  private toProgress(state: DraftState): ToolCallProgress {
    return {
      draft: state.draft,
      status: state.status,
      preview: state.draft.parsedArguments || undefined,
      rawPreview: this.buildRawPreview(state),
      error: state.error,
      updatedAt: state.updatedAt,
    };
  }

  private buildRawPreview(state: DraftState): string {
    return state.draft.rawArguments;
  }

}
