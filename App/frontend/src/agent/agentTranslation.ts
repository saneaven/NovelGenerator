import { useSettingsStore } from '../store/settingsStore';
import { useLLMSessionStore } from '../store/llmSessionStore';
import { startLLMSession } from '../llmSession';
import {
  LLMTaskMode,
  type AgentTranslationPromptContext,
  createEmptyUserHistory,
} from '../llm';
import type { ContentPart } from '../llm/requestTypes';
import { registerSessionNotification, updateSessionNotification } from '../llmTask/notificationHelpers';
import { useAgentUIStore } from '../store/agentUIStore';
import { runService } from '../api/runService';
import { useRuntimeStore } from '../runtime';
import { buildLangEntry } from '../runtime/utils/displayMessage';

export interface AgentTranslationInput {
  projectId: string;
  agentId: string;
  runId: string;
  runMessageId: string;
  sourceLanguage: string;
  targetLanguage: string;
  sourceContent: string;
  originalContentParts: ContentPart[];
}

export interface AgentTranslationResult {
  agentId: string;
  runMessageId: string;
  targetLanguage: string;
}

export async function runAgentTranslation(
  input: AgentTranslationInput,
  onSessionCreated?: (sessionId: string) => void,
): Promise<string> {
  const settingsStore = useSettingsStore.getState();
  const sessionStore = useLLMSessionStore.getState();

  const translationConfig = settingsStore.getTaskConfig('translation');

  const promptContext: AgentTranslationPromptContext = {
    projectId: input.projectId,
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
    sourceContent: input.sourceContent,
    outputMode: 'raw_output',
    outputLanguage: input.targetLanguage,
    enable_prefill: translationConfig.advanced.enable_prefill,
    thinking_mode: translationConfig.advanced.thinking_mode,
  };

  const handle = startLLMSession<AgentTranslationInput, AgentTranslationResult>({
    kind: 'agentTranslation',
    label: 'Agent Translation',
    input,
    mode: LLMTaskMode.AGENT_TRANSLATION,
    projectId: input.projectId,
    promptContext,
    provider: translationConfig.provider,
    model: translationConfig.model,
    temperature: translationConfig.temperature,
    thinking_mode: translationConfig.advanced.thinking_mode as any,
    thinking_config: translationConfig.advanced.thinking_config,
    retryConfig: settingsStore.getSettings().retryConfig,
    history: createEmptyUserHistory(),
  });

  const sessionId = handle.sessionId;

  const initialSession = sessionStore.getSessionById(sessionId);
  if (initialSession) {
    registerSessionNotification(initialSession, {
      onClick: () => useAgentUIStore.getState().openDetailModal(sessionId),
      onDismiss: () => sessionStore.clearSession(sessionId),
    });
  }

  onSessionCreated?.(sessionId);

  void handle.done.then(async (finalSession) => {
    const currentSession = useLLMSessionStore.getState().getSessionById(sessionId);
    if (currentSession) updateSessionNotification(sessionId, currentSession);

    if (finalSession.status !== 'success') {
      return;
    }

    const translated = finalSession.contentParts
      .filter((part: ContentPart) => part.type === 'content')
      .map((part: ContentPart) => part.text)
      .join('')
      .trim();

    if (!translated) {
      useLLMSessionStore.getState().updateSession(sessionId, {
        status: 'error',
        error: 'AI did not generate a translation.',
      } as any);
      const updated = useLLMSessionStore.getState().getSessionById(sessionId);
      if (updated) updateSessionNotification(sessionId, updated);
      return;
    }

    const translatedContentParts = input.originalContentParts.map((part) => {
      if (part.type === 'content') {
        return { ...part, text: translated };
      }
      return part;
    });

    const langEntry = buildLangEntry(translatedContentParts as Array<{ type: string; text: string }>);

    // Persist to backend
    try {
      await runService.translateRunMessage(
        input.projectId,
        input.agentId,
        input.runId,
        input.runMessageId,
        {
          language: input.targetLanguage,
          content_parts: translatedContentParts as Array<Record<string, any>>,
        },
      );
    } catch (error) {
      console.error('Failed to persist translation to backend:', error);
    }

    // Update local store
    useRuntimeStore.getState().addRunMessageTranslation(
      input.runId,
      input.runMessageId,
      input.targetLanguage,
      langEntry,
    );

    useLLMSessionStore.getState().updateSession(sessionId, {
      status: 'success',
      result: { agentId: input.agentId, runMessageId: input.runMessageId, targetLanguage: input.targetLanguage },
    } as any);
    const updated = useLLMSessionStore.getState().getSessionById(sessionId);
    if (updated) updateSessionNotification(sessionId, updated);
  });

  return sessionId;
}
