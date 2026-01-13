import type { ConversationBlock, ChatMessage, ToolResultBlock, FunctionCallMetadata } from '../llm/requestTypes';
import type { FunctionCallSchema } from '../functionCall';
import { PromptManager } from '../llm/PromptManager';
import type { OutputMode, TemplateData } from '../llm/types';
import { useSettingsStore } from '../store/settingsStore';
import { useLLMTaskStore } from '../store/llmTaskStore';
import { useJourneyStore, type Journey } from '../store/journeyStore';
import { LLMTaskExecutor } from '../llmTask/LLMTaskExecutor';
import {
  stageSessionEdits,
  applySessionEdits,
  rejectAllSessionEdits,
  toFunctionCallMetadata,
} from '../llmTask/functionCalls/functionCallEngine';
import type { HandlerOptions } from '../functionCall/applicator/types';
import { registerJourneyNotification, updateJourneyNotification } from './notificationHelpers';
import { generateTempId } from '../utils/tempId';
import { journeySpecs, getJourneySpec, type JourneyKind } from './journeySpecs';
import type { LLMTaskJourney, JourneySpec } from './types';
import { createChatMessage, collapseContentParts } from './types';

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function buildConfigTemplateData(params: { outputMode: OutputMode }): TemplateData['config'] {
  const { outputMode } = params;
  const store = useSettingsStore.getState();
  const settings = store.settings;

  return {
    mainLanguage: settings.mainLanguage,
    displayLanguage: settings.displayLanguage || settings.mainLanguage,
    today: new Date().toISOString().split('T')[0],
    isThinkingEnabled: false,
    isPrefillEnabled: false,
    isCustomThinkingEnabled: false,
    outputMode,
    isNativeFunctionCallMode: outputMode === 'native_function_call',
    isRawOutputMode: outputMode === 'raw_output',
  };
}

async function loadCommonPrompt(params: {
  category: 'userPrompt' | 'nonLastUserPrompt';
  name: string;
}): Promise<string> {
  const { category, name } = params;
  const store = useSettingsStore.getState();

  const cached = store.getPromptFromCache('common', category, name);
  if (cached) return cached;

  return await store.loadPrompt('common', category, name);
}

function toToolResultBlock(params: { fc: NonNullable<ChatMessage['functionCalls']>[number] }): ToolResultBlock {
  const { fc } = params;

  let content: string;
  switch (fc.status) {
    case 'accepted':
      content = fc.result?.message || 'Applied successfully';
      break;
    case 'rejected':
      content = fc.reason ? `User rejected: ${fc.reason}` : 'User rejected this action';
      break;
    case 'failed':
      content = `Failed: ${fc.reason || 'Unknown error'}`;
      break;
    default:
      content = 'Pending user confirmation';
  }

  return {
    tool_call_id: fc.id,
    function_name: fc.function_name,
    content,
  };
}

function getMessageText(msg: ChatMessage): string {
  return msg.contentParts
    .filter((p) => p.type === 'content')
    .map((p) => p.text)
    .join('');
}

// =====================================================================
// Journey Function Call Sync Helpers
// =====================================================================

function findLastAssistantMessageId(journey: Journey | LLMTaskJourney): string | null {
  for (let i = journey.messages.length - 1; i >= 0; i--) {
    const msg = journey.messages[i];
    if (msg.role === 'assistant') return msg.id;
  }
  return null;
}

function updateJourneyAssistantFunctionCalls(params: {
  journeyId: string;
  assistantMessageId: string;
  functionCalls: FunctionCallMetadata[];
}): void {
  const { journeyId, assistantMessageId, functionCalls } = params;
  const journeyStore = useJourneyStore.getState();
  const journey = journeyStore.getJourneyById(journeyId);
  if (!journey) return;

  const nextMessages = journey.messages.map((m) =>
    m.id === assistantMessageId ? { ...m, functionCalls } : m
  );
  journeyStore.updateJourney(journeyId, { messages: nextMessages });
}

function syncAssistantFunctionCallsFromCards(params: {
  journeyId: string;
  assistantMessageId: string;
}): void {
  const { journeyId, assistantMessageId } = params;
  const journeyStore = useJourneyStore.getState();
  const journey = journeyStore.getJourneyById(journeyId);
  const cards = journey?.editCards ?? [];
  if (!cards.length) return;
  updateJourneyAssistantFunctionCalls({
    journeyId,
    assistantMessageId,
    functionCalls: toFunctionCallMetadata(cards),
  });
}

async function stageJourneyEdits(params: {
  journeyId: string;
  assistantMessageId: string;
  projectId: string;
  language: string;
  functionCalls: FunctionCallMetadata[];
}): Promise<void> {
  const { journeyId, assistantMessageId, projectId, language, functionCalls } = params;

  // Store the initial (pending) tool calls on the assistant message.
  updateJourneyAssistantFunctionCalls({ journeyId, assistantMessageId, functionCalls });

  // Stage edits - this stores editCards in journeyStore now
  await stageJourneyEditsInStore({ journeyId, projectId, language, functionCalls });

  // Mirror validation results back into the assistant message for tool_results.
  syncAssistantFunctionCallsFromCards({ journeyId, assistantMessageId });
}

/**
 * Stage edit cards in journeyStore (not llmTaskStore)
 */
async function stageJourneyEditsInStore(params: {
  journeyId: string;
  projectId: string;
  language: string;
  functionCalls: FunctionCallMetadata[];
}): Promise<void> {
  const { journeyId, projectId, language, functionCalls } = params;

  // Use existing stageSessionEdits but with journeyId as sessionId
  // The function will store editCards which we'll then copy to journeyStore
  await stageSessionEdits({ sessionId: journeyId, projectId, language, functionCalls });

  // Copy editCards from llmTaskStore session to journeyStore
  const llmTaskStore = useLLMTaskStore.getState();
  const session = llmTaskStore.getSessionById(journeyId);
  if (session?.editCards) {
    useJourneyStore.getState().updateJourney(journeyId, { editCards: session.editCards });
  }
}

/**
 * Apply journey edits with sync
 */
export async function applyJourneyEdits(params: {
  journeyId: string;
  projectId: string;
  language: string;
  selections: Record<string, boolean>;
  options: HandlerOptions;
}): Promise<void> {
  const { journeyId, projectId, language, selections, options } = params;
  const journeyStore = useJourneyStore.getState();
  const journey = journeyStore.getJourneyById(journeyId);
  const assistantMessageId = journey ? findLastAssistantMessageId(journey) : null;

  // Use journeyId as sessionId for applySessionEdits
  await applySessionEdits({ sessionId: journeyId, projectId, language, selections, options });

  // Copy updated editCards and status from llmTaskStore to journeyStore
  const session = useLLMTaskStore.getState().getSessionById(journeyId);
  if (session) {
    journeyStore.updateJourney(journeyId, {
      editCards: session.editCards,
      status: session.status,
      error: session.error,
    });
  }

  if (assistantMessageId) {
    syncAssistantFunctionCallsFromCards({ journeyId, assistantMessageId });
  }

  // Update notification with new status
  const updatedJourney = journeyStore.getJourneyById(journeyId);
  if (updatedJourney) {
    updateJourneyNotification(journeyId, updatedJourney);
  }
}

/**
 * Reject all journey edits with sync
 */
export function rejectAllJourneyEdits(params: { journeyId: string; reason?: string }): void {
  const { journeyId, reason } = params;
  const journeyStore = useJourneyStore.getState();
  const journey = journeyStore.getJourneyById(journeyId);
  const assistantMessageId = journey ? findLastAssistantMessageId(journey) : null;

  // Use journeyId as sessionId for rejectAllSessionEdits
  rejectAllSessionEdits({ sessionId: journeyId, reason });

  // Copy updated editCards and status from llmTaskStore to journeyStore
  const session = useLLMTaskStore.getState().getSessionById(journeyId);
  if (session) {
    journeyStore.updateJourney(journeyId, {
      editCards: session.editCards,
      status: session.status,
    });
  }

  if (assistantMessageId) {
    syncAssistantFunctionCallsFromCards({ journeyId, assistantMessageId });
  }

  // Update notification with new status
  const updatedJourney = journeyStore.getJourneyById(journeyId);
  if (updatedJourney) {
    updateJourneyNotification(journeyId, updatedJourney);
  }
}

async function buildPreparedRequest(params: {
  journey: LLMTaskJourney;
  config: ReturnType<JourneySpec<any>['buildLLMConfig']>;
}): Promise<{ messages: ConversationBlock[]; functions?: FunctionCallSchema[]; outputMode: OutputMode }> {
  const { journey, config } = params;
  const { settings } = useSettingsStore.getState();
  const fcLimit = settings.functionCallHistoryLimit;

  const outputMode = config.prepared?.outputMode ?? 'raw_output';
  const blocks: ConversationBlock[] = [];

  // 1) Prefix is fixed (no re-render)
  for (const msg of journey.preConversation) {
    blocks.push({
      role: msg.role,
      contentParts: msg.contentParts.length > 0 ? msg.contentParts : [{ type: 'content', text: '' }],
    });
  }

  // 2) Load feedback templates only if we have user messages after prefix
  const lastUserIndex = (() => {
    for (let i = journey.messages.length - 1; i >= 0; i--) {
      if (journey.messages[i].role === 'user') return i;
    }
    return -1;
  })();

  const [userPromptTemplate, nonLastUserPromptTemplate] = lastUserIndex >= 0
    ? await Promise.all([
        loadCommonPrompt({ category: 'userPrompt', name: 'feedback' }),
        loadCommonPrompt({ category: 'nonLastUserPrompt', name: 'feedback' }),
      ])
    : [null, null];

  const editingObjectIds = (() => {
    const t = journey.editingTargets;
    if (t.kind === 'aiEdit') return [t.targetId];
    if (t.kind === 'translateObjects') return t.objectIds;
    return [];
  })();

  const templateProjectLanguage = (() => {
    const t = journey.editingTargets;
    if (t.kind === 'aiEdit') return t.language;
    if (t.kind === 'translateObjects') return t.targetLanguage;
    return useSettingsStore.getState().settings.mainLanguage;
  })();

  const baseTemplateData: Pick<TemplateData, 'config' | 'project' | 'feedback'> = {
    config: buildConfigTemplateData({ outputMode }),
    project: PromptManager.buildProjectData(config.projectId, templateProjectLanguage),
    feedback: { editingObjectIds },
  };

  // 3) Count assistant messages to decide which include tool_calls
  const assistantIndices: number[] = [];
  for (let i = 0; i < journey.messages.length; i++) {
    if (journey.messages[i].role === 'assistant') assistantIndices.push(i);
  }
  const totalAssistants = assistantIndices.length;

  let assistantCount = 0;
  for (let i = 0; i < journey.messages.length; i++) {
    const msg = journey.messages[i];

    if (msg.role === 'user') {
      if (!userPromptTemplate || !nonLastUserPromptTemplate) {
        throw new Error('Feedback prompt templates are missing.');
      }

      const template = i === lastUserIndex ? userPromptTemplate : nonLastUserPromptTemplate;
      const rendered = PromptManager.renderTemplate(template, {
        ...baseTemplateData,
        input: { userMessage: getMessageText(msg) },
      });

      blocks.push({
        role: 'user',
        contentParts: [{ type: 'content', text: rendered }],
      });
      continue;
    }

    if (msg.role === 'assistant') {
      assistantCount++;
      const shouldIncludeFC =
        fcLimit === -1 || (fcLimit > 0 && assistantCount > totalAssistants - fcLimit);

      const block: ConversationBlock = {
        role: 'assistant',
        contentParts: msg.contentParts.length > 0 ? msg.contentParts : [{ type: 'content', text: '' }],
      };

      if (shouldIncludeFC && (msg.functionCalls?.length ?? 0) > 0) {
        block.tool_calls = msg.functionCalls!.map((fc) => ({
          id: fc.id,
          type: 'function',
          function: {
            name: fc.function_name,
            arguments: typeof fc.arguments === 'string' ? fc.arguments : JSON.stringify(fc.arguments),
          },
        }));
      }

      blocks.push(block);

      const toolResults = (msg.functionCalls ?? []).filter((fc) => fc.status !== 'pending').map((fc) =>
        toToolResultBlock({ fc })
      );
      if (toolResults.length) {
        blocks.push({ role: 'tool_results', contentParts: [], tool_results: toolResults });
      }
      continue;
    }

    // Other roles (rare)
    blocks.push({
      role: msg.role,
      contentParts: msg.contentParts.length > 0 ? msg.contentParts : [{ type: 'content', text: '' }],
    });
  }

  return { messages: blocks, functions: config.prepared?.functions, outputMode };
}

async function runAttempt(params: { journeyId: string }): Promise<void> {
  const { journeyId } = params;
  const journeyStore = useJourneyStore.getState();
  const llmTaskStore = useLLMTaskStore.getState();

  const journey = journeyStore.getJourneyById(journeyId);
  if (!journey) {
    throw new Error(`Journey not found: ${journeyId}`);
  }

  const kind = journey.kind;
  if (!(kind in journeySpecs)) {
    throw new Error(`Task kind is not supported by journey mode: ${kind}`);
  }

  const spec = getJourneySpec(kind);

  if (journey.preConversation.length === 0) {
    journeyStore.updateJourney(journeyId, { status: 'error', error: 'Journey is missing preConversation.' });
    updateJourneyNotification(journeyId, journeyStore.getJourneyById(journeyId)!);
    return;
  }

  // Build LLM config using the new spec interface
  // We need to convert Journey to LLMTaskJourney for the spec
  const legacyJourney: LLMTaskJourney = {
    id: journey.id,
    label: journey.label,
    createdAt: journey.createdAt,
    updatedAt: journey.updatedAt,
    preConversation: journey.preConversation,
    editingTargets: journey.editingTargets,
    functions: journey.functions,
    messages: journey.messages,
  };

  let llmConfig: ReturnType<typeof spec.buildLLMConfig>;
  try {
    llmConfig = spec.buildLLMConfig(journey.input, legacyJourney);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    journeyStore.updateJourney(journeyId, { status: 'error', error: message });
    updateJourneyNotification(journeyId, journeyStore.getJourneyById(journeyId)!);
    return;
  }

  // Build request BEFORE adding the assistant placeholder message.
  let prepared: Awaited<ReturnType<typeof buildPreparedRequest>>;
  try {
    prepared = await buildPreparedRequest({ journey: legacyJourney, config: llmConfig });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    journeyStore.updateJourney(journeyId, { status: 'error', error: message });
    updateJourneyNotification(journeyId, journeyStore.getJourneyById(journeyId)!);
    return;
  }

  // Append assistant placeholder for streaming UI.
  const assistantMessage = createChatMessage({ role: 'assistant', content: '', idPrefix: 'journey-assistant' });
  const assistantIndex = journey.messages.length;

  journeyStore.updateJourney(journeyId, {
    messages: [...journey.messages, assistantMessage],
    status: 'running',
    error: undefined,
    warning: undefined,
    currentContentParts: [],
    currentFunctionCallProgress: [],
    editCards: undefined,
  });

  // Update notification status
  updateJourneyNotification(journeyId, journeyStore.getJourneyById(journeyId)!);

  // Create executor and register abort controller in journeyStore
  const executor = new LLMTaskExecutor();
  journeyStore.registerAbortController(journeyId, { abort: () => executor.abort() } as AbortController);

  // Also create a minimal session in llmTaskStore for edit card staging
  llmTaskStore.createSession({
    id: journeyId,
    kind: journey.kind,
    input: journey.input,
    label: journey.label,
    status: 'running',
    createdAt: journey.createdAt,
    updatedAt: Date.now(),
    isRead: false,
    contentParts: [],
    functionCallProgress: [],
  } as any);

  let finalResult: any = null;

  try {
    await executor.execute(
      {
        mode: llmConfig.mode,
        projectId: llmConfig.projectId,
        promptContext: llmConfig.promptContext,
        prepared,
      },
      {
        onStreamingUpdate: (parts) => {
          const currentJourney = journeyStore.getJourneyById(journeyId);
          if (!currentJourney) return;

          const nextAssistant: ChatMessage = {
            ...currentJourney.messages[assistantIndex],
            contentParts: parts,
          };
          const nextMessages = currentJourney.messages.slice();
          nextMessages[assistantIndex] = nextAssistant;

          journeyStore.updateJourney(journeyId, {
            messages: nextMessages,
            currentContentParts: parts,
          });
        },
        onFunctionProgress: (progress) => {
          journeyStore.updateJourney(journeyId, { currentFunctionCallProgress: progress });
        },
        onComplete: (r) => {
          finalResult = r;
        },
        onError: () => {
          // handled by catch
        },
      }
    );
  } catch (error) {
    if (isAbortError(error)) {
      journeyStore.updateJourney(journeyId, { status: 'cancelled' });
    } else {
      const message = error instanceof Error ? error.message : String(error);
      journeyStore.updateJourney(journeyId, { status: 'error', error: message });
    }
    updateJourneyNotification(journeyId, journeyStore.getJourneyById(journeyId)!);
    llmTaskStore.clearSession(journeyId);
    return;
  } finally {
    journeyStore.unregisterAbortController(journeyId);
  }

  if (!finalResult) {
    journeyStore.updateJourney(journeyId, { status: 'error', error: 'AI request finished without a result.' });
    updateJourneyNotification(journeyId, journeyStore.getJourneyById(journeyId)!);
    llmTaskStore.clearSession(journeyId);
    return;
  }

  // Finalize assistant message (content + thinking + tool calls)
  const currentJourney = journeyStore.getJourneyById(journeyId)!;
  const finalizedAssistant: ChatMessage = {
    ...currentJourney.messages[assistantIndex],
    contentParts: finalResult.contentParts ?? [],
    functionCalls: finalResult.functionCalls ?? [],
    thinking_details: finalResult.thinkingDetails ?? undefined,
  };
  const finalizedMessages = currentJourney.messages.slice();
  finalizedMessages[assistantIndex] = finalizedAssistant;

  journeyStore.updateJourney(journeyId, {
    messages: finalizedMessages,
    provider: finalResult.provider,
    model: finalResult.model,
    usage: finalResult.usage,
  });

  // Determine output mode
  const outputMode = prepared.outputMode;

  // Raw output mode: delegate to spec.handleRawOutput
  if (outputMode === 'raw_output') {
    const text = collapseContentParts(finalResult.contentParts ?? []).trim();
    if (!text) {
      journeyStore.updateJourney(journeyId, { status: 'error', error: 'AI response was empty.' });
      updateJourneyNotification(journeyId, journeyStore.getJourneyById(journeyId)!);
      llmTaskStore.clearSession(journeyId);
      return;
    }

    try {
      const specWithHandler = spec as JourneySpec<any, any>;
      const updatedJourney = journeyStore.getJourneyById(journeyId)!;
      const updatedLegacyJourney: LLMTaskJourney = {
        id: updatedJourney.id,
        label: updatedJourney.label,
        createdAt: updatedJourney.createdAt,
        updatedAt: updatedJourney.updatedAt,
        preConversation: updatedJourney.preConversation,
        editingTargets: updatedJourney.editingTargets,
        functions: updatedJourney.functions,
        messages: updatedJourney.messages,
      };

      if (specWithHandler.handleRawOutput) {
        const result = await specWithHandler.handleRawOutput(journey.input, updatedLegacyJourney, text);
        if (result !== undefined) {
          journeyStore.updateJourney(journeyId, { result });
        }
      }
      journeyStore.updateJourney(journeyId, { status: 'success' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      journeyStore.updateJourney(journeyId, { status: 'error', error: message });
    }
    updateJourneyNotification(journeyId, journeyStore.getJourneyById(journeyId)!);
    llmTaskStore.clearSession(journeyId);
    return;
  }

  // Tool call modes: stage edit cards for confirmation.
  const functionCalls = finalResult.functionCalls ?? [];
  if (!functionCalls.length) {
    journeyStore.updateJourney(journeyId, { status: 'error', error: 'AI response did not include any actions to apply.' });
    updateJourneyNotification(journeyId, journeyStore.getJourneyById(journeyId)!);
    llmTaskStore.clearSession(journeyId);
    return;
  }

  const updatedJourney = journeyStore.getJourneyById(journeyId)!;
  const language = (() => {
    const t = updatedJourney.editingTargets;
    if (t.kind === 'translateObjects') return t.targetLanguage;
    if (t.kind === 'aiEdit') return t.language;
    return useSettingsStore.getState().settings.mainLanguage;
  })();

  try {
    await stageJourneyEdits({
      journeyId,
      assistantMessageId: finalizedAssistant.id,
      projectId: llmConfig.projectId,
      language,
      functionCalls,
    });
    journeyStore.updateJourney(journeyId, { status: 'pending_confirmation' });
    updateJourneyNotification(journeyId, journeyStore.getJourneyById(journeyId)!);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    journeyStore.updateJourney(journeyId, { status: 'error', error: message });
    updateJourneyNotification(journeyId, journeyStore.getJourneyById(journeyId)!);
    llmTaskStore.clearSession(journeyId);
  }
}

async function initJourney(params: { journeyId: string; kind: JourneyKind; input: any }): Promise<void> {
  const { journeyId, kind, input } = params;
  const journeyStore = useJourneyStore.getState();
  const journey = journeyStore.getJourneyById(journeyId);
  if (!journey) return;

  const spec = getJourneySpec(kind);

  // Convert to legacy format for spec
  const legacyJourney: LLMTaskJourney = {
    id: journey.id,
    label: journey.label,
    createdAt: journey.createdAt,
    updatedAt: journey.updatedAt,
    preConversation: journey.preConversation,
    editingTargets: journey.editingTargets,
    functions: journey.functions,
    messages: journey.messages,
  };

  // Build LLM config to get prompt context
  const llmConfig = spec.buildLLMConfig(input, legacyJourney);

  const promptBundle = await PromptManager.generatePromptBundle(llmConfig.mode, llmConfig.promptContext);
  const preConversation: ChatMessage[] = [
    createChatMessage({ role: 'system', content: promptBundle.systemPrompt, idPrefix: 'journey-pre' }),
    createChatMessage({ role: 'user', content: promptBundle.userPrompt, idPrefix: 'journey-pre' }),
  ];
  if (promptBundle.prefill) {
    preConversation.push(createChatMessage({ role: 'assistant', content: promptBundle.prefill, idPrefix: 'journey-pre' }));
  }

  journeyStore.updateJourney(journeyId, {
    preConversation,
    functions: llmConfig.prepared?.functions,
  });
}

export const JourneyRuntime = {
  /**
   * Start a new journey
   * Creates journey in journeyStore (permanent) and returns journeyId
   */
  start<TInput>(kind: JourneyKind, input: TInput): string {
    const journeyId = `llm-journey-${generateTempId()}`;
    const journeyStore = useJourneyStore.getState();

    // Cast spec to any to handle the generic type variance
    const spec = getJourneySpec(kind) as JourneySpec<TInput>;
    const label = spec.label(input);
    const now = Date.now();

    // Create journey in journeyStore (permanent storage)
    const journey: Journey<TInput, unknown> = {
      id: journeyId,
      kind,
      input,
      label,
      status: 'running',
      createdAt: now,
      updatedAt: now,
      isRead: false,
      preConversation: [],
      editingTargets: spec.buildEditingTargets(input),
      functions: undefined,
      messages: [],
      currentContentParts: [],
      currentFunctionCallProgress: [],
    };

    journeyStore.createJourney(journey as any);

    // Register notification with journeyStore modal
    registerJourneyNotification(journey as any, {
      onClick: () => useJourneyStore.getState().openDetailModal(journeyId),
      onDismiss: () => useJourneyStore.getState().clearJourney(journeyId),
    });

    void (async () => {
      try {
        await initJourney({ journeyId, kind, input });
        await runAttempt({ journeyId });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        journeyStore.updateJourney(journeyId, { status: 'error', error: message });
        updateJourneyNotification(journeyId, journeyStore.getJourneyById(journeyId)!);
      }
    })();

    return journeyId;
  },

  /**
   * Send feedback to continue a journey (multi-turn)
   */
  sendFeedback(params: { journeyId: string; text: string }): void {
    const { journeyId, text } = params;
    const journeyStore = useJourneyStore.getState();
    const journey = journeyStore.getJourneyById(journeyId);

    if (!journey) {
      throw new Error(`Journey not found: ${journeyId}`);
    }

    if (journey.status === 'running' || journey.status === 'applying') {
      return;
    }

    const trimmed = text.trim();
    if (!trimmed) return;

    journeyStore.updateJourney(journeyId, {
      messages: [
        ...journey.messages,
        createChatMessage({ role: 'user', content: trimmed, idPrefix: 'journey-user' }),
      ],
    });

    void runAttempt({ journeyId });
  },
};
