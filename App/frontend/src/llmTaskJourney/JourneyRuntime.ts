import type { ConversationBlock, ChatMessage, ToolResultBlock } from '../llm/requestTypes';
import { LLMTask } from '../llm/LLMTask';
import { PromptManager } from '../llm/PromptManager';
import type { OutputMode, TemplateData } from '../llm/types';
import { useSettingsStore } from '../store/settingsStore';
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import { useLLMTaskStore } from '../store/llmTaskStore';
import type { TaskKind, TaskSessionState } from '../llmTask';
import { getTaskSpec } from '../llmTask/specs/specRegistry';
import { generateTempId } from '../utils/tempId';
import { stageJourneyEdits } from './functionCalls/journeyFunctionCallEngine';
import { journeySpecs } from './journeySpecs';
import type { JourneyAttemptConfig } from './journeySpecs';
import type { LLMTaskJourney } from './types';
import { createChatMessage, collapseContentParts } from './types';

type JourneyTaskKind = keyof typeof journeySpecs;

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

async function buildPreparedRequest(params: {
  journey: LLMTaskJourney;
  attempt: JourneyAttemptConfig;
}): Promise<{ messages: ConversationBlock[]; functions?: JourneyAttemptConfig['functions']; outputMode: OutputMode }> {
  const { journey, attempt } = params;
  const { settings } = useSettingsStore.getState();
  const fcLimit = settings.functionCallHistoryLimit;

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

  const baseTemplateData: Pick<TemplateData, 'config' | 'project' | 'feedback'> = {
    config: buildConfigTemplateData({ outputMode: attempt.outputMode }),
    project: PromptManager.buildProjectData(attempt.projectId, attempt.templateProjectLanguage),
    feedback: { editingObjectIds: attempt.editingObjectIds },
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

  return { messages: blocks, functions: attempt.functions, outputMode: attempt.outputMode };
}

function ensureJourneyKind(kind: TaskKind): asserts kind is JourneyTaskKind {
  if (!(kind in journeySpecs)) {
    throw new Error(`Task kind is not supported by journey mode: ${kind}`);
  }
}

async function handleRawOutput(params: {
  kind: JourneyTaskKind;
  input: any;
  journey: LLMTaskJourney;
  text: string;
}): Promise<{ result?: any }> {
  const { kind, input, journey, text } = params;
  const unifiedStore = useUnifiedObjectStore.getState();

  if (kind === 'aiEdit') {
    const targets = journey.editingTargets;
    if (targets.kind !== 'aiEdit') throw new Error('Invalid journey editingTargets for aiEdit.');

    if (targets.category === 'manuscript') {
      const manuscriptObj = unifiedStore.getManuscriptByChapterId(targets.targetId);
      if (!manuscriptObj) {
        throw new Error(`Manuscript not found for chapter ${targets.targetId}`);
      }
      const currentData = manuscriptObj.data[targets.language] || {};
      await unifiedStore.updateObject('manuscript', manuscriptObj.id, {
        language: targets.language,
        data: { ...currentData, content: text },
        user_request: (input?.userRequest as string | undefined) ?? '',
      });
      return {};
    }

    const obj = unifiedStore.getObject(targets.targetId);
    if (!obj) {
      throw new Error(`Object not found: ${targets.targetId}`);
    }
    const currentData = obj.data[targets.language] || {};
    await unifiedStore.updateObject(obj.type, targets.targetId, {
      language: targets.language,
      data: { ...currentData, description: text },
      user_request: (input?.userRequest as string | undefined) ?? '',
    });
    return {};
  }

  if (kind === 'translateObjects') {
    const targets = journey.editingTargets;
    if (targets.kind !== 'translateObjects') {
      throw new Error('Invalid journey editingTargets for translateObjects.');
    }

    if (targets.objectIds.length !== 1) {
      throw new Error('Raw output translation requires exactly one objectId.');
    }

    const targetId = targets.objectIds[0];
    const obj = unifiedStore.getObject(targetId);
    if (!obj) {
      throw new Error(`Object not found: ${targetId}`);
    }

    const lang = targets.targetLanguage;
    const currentData = obj.data[lang] || {};

    if (obj.type === 'manuscript') {
      await unifiedStore.updateObject('manuscript', targetId, {
        language: lang,
        data: { ...currentData, content: text },
        create_new_version: false,
      });
    } else {
      await unifiedStore.updateObject(obj.type, targetId, {
        language: lang,
        data: { ...currentData, description: text },
        create_new_version: false,
      });
    }
    return {};
  }

  if (kind === 'imagePrompt' || kind === 'sceneImage') {
    const promptMode = (input?.promptMode as string | undefined) ?? 'natural';
    return { result: { prompt: text, mode: promptMode } };
  }

  throw new Error(`Raw output handler not implemented for kind: ${kind}`);
}

async function runAttempt(params: { sessionId: string }): Promise<void> {
  const { sessionId } = params;
  const store = useLLMTaskStore.getState();
  const session = store.getSessionById(sessionId);
  if (!session?.journey) {
    throw new Error(`Journey session not found: ${sessionId}`);
  }

  ensureJourneyKind(session.kind);
  const kind: JourneyTaskKind = session.kind;
  const spec = journeySpecs[kind] as any;
  const journey = session.journey;

  if (journey.preConversation.length === 0) {
    store.updateSession(sessionId, { status: 'error', error: 'Journey is missing preConversation.' } as any);
    return;
  }

  let attempt: JourneyAttemptConfig;
  try {
    attempt = spec.buildAttemptConfig({ input: session.input, journey });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.updateSession(sessionId, { status: 'error', error: message } as any);
    return;
  }

  // Build request BEFORE adding the assistant placeholder message.
  let prepared: Awaited<ReturnType<typeof buildPreparedRequest>>;
  try {
    prepared = await buildPreparedRequest({ journey, attempt });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.updateSession(sessionId, { status: 'error', error: message } as any);
    return;
  }

  // Append assistant placeholder for streaming UI.
  const assistantMessage = createChatMessage({ role: 'assistant', content: '', idPrefix: 'journey-assistant' });
  const assistantIndex = journey.messages.length;
  let liveJourney: LLMTaskJourney = {
    ...journey,
    messages: [...journey.messages, assistantMessage],
    updatedAt: Date.now(),
  };

  store.updateSession(sessionId, {
    journey: liveJourney,
    status: 'running',
    error: undefined,
    warning: undefined,
    contentParts: [],
    functionCallProgress: [],
    editCards: undefined,
  } as any);

  const abortController = new AbortController();
  store.registerAbortController(sessionId, abortController);

  let finalResult: any = null;

  const task = new LLMTask(
    {
      mode: attempt.llmMode,
      projectId: attempt.projectId,
      promptContext: attempt.promptContext,
      abortController,
      prepared,
    },
    {
      onUpdate: (parts) => {
        const nextAssistant: ChatMessage = {
          ...liveJourney.messages[assistantIndex],
          contentParts: parts,
        };
        const nextMessages = liveJourney.messages.slice();
        nextMessages[assistantIndex] = nextAssistant;
        liveJourney = { ...liveJourney, messages: nextMessages, updatedAt: Date.now() };

        store.updateSession(sessionId, {
          contentParts: parts,
          journey: liveJourney,
        } as any);
      },
      onFunctionProgress: (progress) => store.updateSession(sessionId, { functionCallProgress: progress } as any),
      onComplete: (r) => {
        finalResult = r;
      },
      onError: () => {
        // handled by catch
      },
    }
  );

  try {
    await task.run();
  } catch (error) {
    if (isAbortError(error)) {
      store.updateSession(sessionId, { status: 'cancelled' } as any);
    } else {
      const message = error instanceof Error ? error.message : String(error);
      store.updateSession(sessionId, { status: 'error', error: message } as any);
    }
    return;
  } finally {
    store.unregisterAbortController(sessionId);
  }

  if (!finalResult) {
    store.updateSession(sessionId, { status: 'error', error: 'AI request finished without a result.' } as any);
    return;
  }

  // Finalize assistant message (content + thinking + tool calls)
  const finalizedAssistant: ChatMessage = {
    ...liveJourney.messages[assistantIndex],
    contentParts: finalResult.contentParts ?? [],
    functionCalls: finalResult.functionCalls ?? [],
    thinking_details: finalResult.thinkingDetails ?? undefined,
  };
  const finalizedMessages = liveJourney.messages.slice();
  finalizedMessages[assistantIndex] = finalizedAssistant;
  liveJourney = { ...liveJourney, messages: finalizedMessages, updatedAt: Date.now() };

  store.updateSession(sessionId, {
    journey: liveJourney,
    provider: finalResult.provider,
    model: finalResult.model,
    usage: finalResult.usage,
  } as any);

  // Raw output mode: apply immediately (or return result for UI)
  if (attempt.outputMode === 'raw_output') {
    const text = collapseContentParts(finalResult.contentParts ?? []).trim();
    if (!text) {
      store.updateSession(sessionId, { status: 'error', error: 'AI response was empty.' } as any);
      return;
    }

    try {
      const { result } = await handleRawOutput({ kind, input: session.input, journey: liveJourney, text });
      if (result !== undefined) {
        store.updateSession(sessionId, { result } as any);
      }
      store.updateSession(sessionId, { status: 'success' } as any);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      store.updateSession(sessionId, { status: 'error', error: message } as any);
    }
    return;
  }

  // Tool call modes: stage edit cards for confirmation.
  const functionCalls = finalResult.functionCalls ?? [];
  if (!functionCalls.length) {
    store.updateSession(sessionId, { status: 'error', error: 'AI response did not include any actions to apply.' } as any);
    return;
  }

  const language = (() => {
    const t = liveJourney.editingTargets;
    if (t.kind === 'translateObjects') return t.targetLanguage;
    if (t.kind === 'aiEdit') return t.language;
    return useSettingsStore.getState().settings.mainLanguage;
  })();

  try {
    await stageJourneyEdits({
      sessionId,
      assistantMessageId: finalizedAssistant.id,
      projectId: attempt.projectId,
      language,
      functionCalls,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.updateSession(sessionId, { status: 'error', error: message } as any);
  }
}

async function initJourneySession(params: { sessionId: string; kind: JourneyTaskKind; input: any }): Promise<void> {
  const { sessionId, kind, input } = params;
  const store = useLLMTaskStore.getState();
  const session = store.getSessionById(sessionId);
  if (!session?.journey) return;

  const spec = journeySpecs[kind] as any;

  const journey = session.journey;
  const attempt: JourneyAttemptConfig = spec.buildAttemptConfig({ input, journey });

  const promptBundle = await PromptManager.generatePromptBundle(attempt.llmMode, attempt.promptContext);
  const preConversation: ChatMessage[] = [
    createChatMessage({ role: 'system', content: promptBundle.systemPrompt, idPrefix: 'journey-pre' }),
    createChatMessage({ role: 'user', content: promptBundle.userPrompt, idPrefix: 'journey-pre' }),
  ];
  if (promptBundle.prefill) {
    preConversation.push(createChatMessage({ role: 'assistant', content: promptBundle.prefill, idPrefix: 'journey-pre' }));
  }

  const nextJourney: LLMTaskJourney = {
    ...journey,
    preConversation,
    functions: attempt.functions,
    updatedAt: Date.now(),
  };

  store.updateSession(sessionId, { journey: nextJourney } as any);
}

export const JourneyRuntime = {
  start<TInput>(kind: JourneyTaskKind, input: TInput): string {
    const sessionId = `llm-journey-${generateTempId()}`;
    const store = useLLMTaskStore.getState();

    const label = getTaskSpec(kind).label(input as any);
    const now = Date.now();

    const spec = journeySpecs[kind] as any;
    const journey: LLMTaskJourney = {
      id: sessionId,
      label,
      createdAt: now,
      updatedAt: now,
      preConversation: [],
      editingTargets: spec.buildEditingTargets(input),
      functions: undefined,
      messages: [],
    };

    const session: TaskSessionState<TInput, unknown> = {
      id: sessionId,
      kind,
      input,
      label,
      status: 'running',
      createdAt: now,
      updatedAt: now,
      isRead: false,
      contentParts: [],
      functionCallProgress: [],
      journey,
    } as any;

    store.createSession(session as any);

    void (async () => {
      try {
        await initJourneySession({ sessionId, kind, input });
        await runAttempt({ sessionId });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        store.updateSession(sessionId, { status: 'error', error: message } as any);
      }
    })();

    return sessionId;
  },

  sendFeedback(params: { sessionId: string; text: string }): void {
    const { sessionId, text } = params;
    const store = useLLMTaskStore.getState();
    const session = store.getSessionById(sessionId);
    if (!session?.journey) {
      throw new Error(`Journey session not found: ${sessionId}`);
    }

    if (session.status === 'running' || session.status === 'applying') {
      return;
    }

    const trimmed = text.trim();
    if (!trimmed) return;

    const nextJourney: LLMTaskJourney = {
      ...session.journey,
      messages: [
        ...session.journey.messages,
        createChatMessage({ role: 'user', content: trimmed, idPrefix: 'journey-user' }),
      ],
      updatedAt: Date.now(),
    };

    store.updateSession(sessionId, { journey: nextJourney } as any);

    void runAttempt({ sessionId });
  },
};
