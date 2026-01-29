import type { ToolCallSchema } from '../toolCall';
import { STORY_OBJECT_EDIT_TOOLS, MANUSCRIPT_EDIT_TOOLS, getToolsForSet } from '../toolCall';
import { renderTemplate, registerFragments, type PromptFragment } from '../templateEngine/engine';
import { useSettingsStore } from '../store/settingsStore';
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import { useVariableStore } from '../store/variableStore';
import { fragmentService } from '../api/fragmentService';
import type { UnifiedObject } from '../types/unifiedObject';
import { docWordCount, normalizeDoc } from '../editor/manuscript/doc';
import { docToMarkdown } from '../editor/manuscript/convert';
import {
  LLMTaskMode,
  type LLMTaskModeType,
  type OutputMode,
  type ThinkingMode,
  type PromptBundle,
  type PromptContext,
  type TemplateData,
  type AgentWorkspacePromptContext,
  type AgentNovelEditorPromptContext,
  type AgentOutlineManagerPromptContext,
  type AgentMemorySummaryPromptContext,
  type EditAssistantStoryObjectPromptContext,
  type EditAssistantManuscriptPromptContext,
  type StoryTranslationPromptContext,
  type AgentTranslationPromptContext,
  type ObjectImagePromptContext,
  type SceneImagePromptContext,
  type CoverImagePromptContext,
} from './types';

/**
 * PromptManager - Renders prompt templates for all LLM task modes
 * Uses unified schema: config/project/input + mode-specific groups
 */
export class PromptManager {
  private static fragmentsLoaded = false;

  private static resolveOutputMode(
    context: { outputMode?: OutputMode }
  ): OutputMode {
    return context.outputMode ?? 'tool_call';
  }

  /**
   * Ensure basic project data is available in the unified store before rendering prompts.
   * BasicInfo is required for all prompts and is guaranteed to exist per project.
   */
  private static async ensureBasicInfoLoaded(projectId: string | undefined): Promise<void> {
    if (!projectId) {
      throw new Error('projectId is required for prompt rendering.');
    }
    await useUnifiedObjectStore.getState().listObjects('basic_info', projectId);
  }

  /**
   * Ensure fragments are loaded and registered before rendering templates
   */
  private static async ensureFragmentsLoaded(): Promise<void> {
    if (this.fragmentsLoaded) return;

    try {
      const fragments = await fragmentService.getAllFragmentsWithContent();
      const fragmentData: PromptFragment[] = fragments.map(f => ({
        id: f.id,
        folderPath: f.folder_path,
        fragmentName: f.fragment_name,
        content: f.content,
        description: f.description,
        isSystemDefault: f.is_system_default,
      }));
      registerFragments(fragmentData);
      this.fragmentsLoaded = true;
    } catch (error) {
      console.error('Failed to load fragments:', error);
      // Continue without fragments - they're optional
    }
  }

  /**
   * Force reload of fragments (call when fragments are updated)
   */
  static async reloadFragments(): Promise<void> {
    this.fragmentsLoaded = false;
    await this.ensureFragmentsLoaded();
  }

  /**
   * Load a prompt template from store or fallback to bundled default
   */
  private static async getTemplate(
    functionType: 'agent' | 'translation' | 'editAssistant' | 'imagePrompt',
    category: 'systemPrompt' | 'prefill' | 'userPrompt' | 'initialUserPrompt' | 'firstUserPrompt' | 'lastUserPrompt',
    name: string
  ): Promise<string | null> {
    const store = useSettingsStore.getState();

    const cached = store.getPromptFromCache(functionType, category as any, name);
    if (cached) {
      return cached;
    }

    try {
      return await store.loadPrompt(functionType, category as any, name);
    } catch (error) {
      // Optional templates return null if not found
      if (category === 'initialUserPrompt' || category === 'firstUserPrompt' || category === 'lastUserPrompt') {
        return null;
      }
      console.error('Failed to load prompt:', error);
      throw new Error(`No prompt template found for ${functionType}/${category}/${name}`);
    }
  }

  /**
   * Generate a complete prompt bundle for a given mode and context
   */
  static async generatePromptBundle(
    mode: LLMTaskModeType,
    context: PromptContext
  ): Promise<PromptBundle> {
    // Ensure fragments are loaded before rendering any templates
    await this.ensureFragmentsLoaded();
    await this.ensureBasicInfoLoaded(context.projectId);

    switch (mode) {
      case LLMTaskMode.AGENT_STORYOBJECT:
        return this.generateAgentBundle(context as AgentWorkspacePromptContext, 'storyObject');
      case LLMTaskMode.AGENT_NOVEL_EDITOR:
        return this.generateAgentBundle(context as AgentNovelEditorPromptContext, 'novelEditor');
      case LLMTaskMode.AGENT_OUTLINE_MANAGER:
        return this.generateAgentBundle(context as AgentOutlineManagerPromptContext, 'outlineManager');
      case LLMTaskMode.AGENT_MEMORY_SUMMARY:
        return this.generateAgentMemorySummaryBundle(context as AgentMemorySummaryPromptContext);
      case LLMTaskMode.EDIT_ASSISTANT_STORY_OBJECT:
        return this.generateEditAssistantBundle(context as EditAssistantStoryObjectPromptContext, 'storyObject');
      case LLMTaskMode.EDIT_ASSISTANT_MANUSCRIPT:
        return this.generateEditAssistantBundle(context as EditAssistantManuscriptPromptContext, 'manuscript');
      case LLMTaskMode.TRANSLATION:
        return this.generateTranslationBundle(context as StoryTranslationPromptContext);
      case LLMTaskMode.AGENT_TRANSLATION:
        return this.generateAgentTranslationBundle(context as AgentTranslationPromptContext);
      case LLMTaskMode.OBJECT_IMAGE_PROMPT:
        return this.generateObjectImagePromptBundle(context as ObjectImagePromptContext);
      case LLMTaskMode.SCENE_IMAGE_PROMPT:
        return this.generateSceneImagePromptBundle(context as SceneImagePromptContext);
      case LLMTaskMode.COVER_IMAGE_PROMPT:
        return this.generateCoverImagePromptBundle(context as CoverImagePromptContext);
      default:
        throw new Error(`Unknown LLM task mode: ${mode}`);
    }
  }

  static renderTemplate(template: string, data: Record<string, any>): string {
    return renderTemplate(template, data);
  }

  static getToolsForMode(
    mode: LLMTaskModeType,
    context: PromptContext
  ): ToolCallSchema[] | undefined {
    const outputMode = this.resolveOutputMode(context);
    if (outputMode !== 'tool_call') return undefined;

    switch (mode) {
      case LLMTaskMode.AGENT_STORYOBJECT:
      case LLMTaskMode.AGENT_NOVEL_EDITOR:
      case LLMTaskMode.AGENT_OUTLINE_MANAGER:
        return (context as AgentWorkspacePromptContext).tools;
      case LLMTaskMode.EDIT_ASSISTANT_STORY_OBJECT:
        return this.getEditAssistantTools('storyObject');
      case LLMTaskMode.EDIT_ASSISTANT_MANUSCRIPT:
        return this.getEditAssistantTools('manuscript');
      case LLMTaskMode.TRANSLATION:
        return getToolsForSet('translateObjects');
      case LLMTaskMode.AGENT_TRANSLATION:
        return undefined;
      case LLMTaskMode.OBJECT_IMAGE_PROMPT:
        return undefined; // Image prompt always uses raw output
      case LLMTaskMode.SCENE_IMAGE_PROMPT:
        return undefined;
      case LLMTaskMode.COVER_IMAGE_PROMPT:
        return undefined; // Cover image always uses native output
      default:
        return undefined;
    }
  }

  // ==================== Agent (Workspace & NovelEditor) ====================

  private static async generateAgentBundle(
    context: AgentWorkspacePromptContext | AgentNovelEditorPromptContext | AgentOutlineManagerPromptContext,
    mode: 'storyObject' | 'novelEditor' | 'outlineManager'
  ): Promise<PromptBundle> {
    const [systemTemplate, userTemplate, firstTemplate, lastTemplate, prefillTemplate] = await Promise.all([
      this.getTemplate('agent', 'systemPrompt', mode),
      this.getTemplate('agent', 'userPrompt', mode),
      this.getTemplate('agent', 'firstUserPrompt', mode),
      this.getTemplate('agent', 'lastUserPrompt', mode),
      this.getTemplate('agent', 'prefill', mode),
    ]);

    const settings = useSettingsStore.getState().settings;
    const variables = useVariableStore.getState().getVariablesForTemplate();
    const previousSummary = Array.isArray((context as any).previousSummary) ? (context as any).previousSummary : [];
    const relevantChats = Array.isArray((context as any).relevantChats) ? (context as any).relevantChats : [];
    const templateData: TemplateData = {
      config: this.buildConfigData(context),
      project: this.buildProjectData(context.projectId, settings.mainLanguage),
      input: {
        // userMessage is injected per user block in prepareMessages()
      },
      agent: {
        mode,
        contextObjectIds: context.contextObjectIds,
        selectedOutlineId: (context as any).selectedOutlineId,
        selectedActId: (context as any).selectedActId,
        previousSummary,
        relevantChats,
      },
      variables,
    };

    return {
      systemPrompt: renderTemplate(systemTemplate!, templateData),
      userPrompt: userTemplate!,                     // Default template for user messages
      firstUserPrompt: firstTemplate ?? undefined,   // Optional template for first message
      lastUserPrompt: lastTemplate ?? undefined,     // Optional template for last message
      prefill: prefillTemplate && context.enablePrefill
        ? renderTemplate(prefillTemplate, templateData)
        : undefined,
      templateData,
    };
  }

  // ==================== Edit Assistant (Manuscript & Story Object) ====================

  private static async generateEditAssistantBundle(
    context: EditAssistantManuscriptPromptContext | EditAssistantStoryObjectPromptContext,
    mode: 'manuscript' | 'storyObject'
  ): Promise<PromptBundle> {
    const [systemTemplate, userTemplate, initialTemplate, firstTemplate, lastTemplate, prefillTemplate] = await Promise.all([
      this.getTemplate('editAssistant', 'systemPrompt', mode),
      this.getTemplate('editAssistant', 'userPrompt', mode),
      this.getTemplate('editAssistant', 'initialUserPrompt', mode),
      this.getTemplate('editAssistant', 'firstUserPrompt', mode),
      this.getTemplate('editAssistant', 'lastUserPrompt', mode),
      this.getTemplate('editAssistant', 'prefill', mode),
    ]);

    const settings = useSettingsStore.getState().settings;
    const variables = useVariableStore.getState().getVariablesForTemplate();
    let templateData: TemplateData;

    if (mode === 'manuscript') {
      const msContext = context as EditAssistantManuscriptPromptContext;
      templateData = {
        config: this.buildConfigData(context),
        project: this.buildProjectData(context.projectId, settings.mainLanguage),
        // Note: input.userMessage is injected per-message in LLMTask.prepareMessages()
        input: { userMessage: '' },
        editAssistant: {
          mode: 'manuscript',
          manuscript: {
            currentId: msContext.currentId,
            currentChapterId: msContext.currentChapterId,
            currentChapterName: msContext.currentChapterName,
            currentChapterManuscript: msContext.currentChapterContent,
            objectIds: msContext.objectIds,
          },
        },
        variables,
      };
    } else {
      const soContext = context as EditAssistantStoryObjectPromptContext;
      templateData = {
        config: this.buildConfigData(context),
        project: this.buildProjectData(context.projectId, settings.mainLanguage),
        // Note: input.userMessage is injected per-message in LLMTask.prepareMessages()
        input: { userMessage: '' },
        editAssistant: {
          mode: 'storyObject',
          storyObject: {
            targetIds: soContext.targetIds,
            contextIds: soContext.contextIds,
            categoryName: soContext.categoryName,
            editScope: soContext.editScope,
          },
        },
        variables,
      };
    }

    return {
      systemPrompt: renderTemplate(systemTemplate!, templateData),
      userPrompt: userTemplate!,  // NOT rendered - will be rendered per-message
      initialUserPrompt: initialTemplate ?? undefined,
      firstUserPrompt: firstTemplate ?? undefined,
      lastUserPrompt: lastTemplate ?? undefined,
      prefill: prefillTemplate && context.enablePrefill
        ? renderTemplate(prefillTemplate, templateData)
        : undefined,
      templateData,
    };
  }

  // ==================== Translation ====================

  private static async generateTranslationBundle(
    context: StoryTranslationPromptContext
  ): Promise<PromptBundle> {
    let systemTemplate: string;
    let userTemplate: string;
    let initialTemplate: string | null;
    let firstTemplate: string | null;
    let lastTemplate: string | null;
    let prefillTemplate: string | null;

    [systemTemplate, userTemplate, initialTemplate, firstTemplate, lastTemplate, prefillTemplate] = await Promise.all([
      this.getTemplate('translation', 'systemPrompt', 'object'),
      this.getTemplate('translation', 'userPrompt', 'object'),
      this.getTemplate('translation', 'initialUserPrompt', 'object'),
      this.getTemplate('translation', 'firstUserPrompt', 'object'),
      this.getTemplate('translation', 'lastUserPrompt', 'object'),
      this.getTemplate('translation', 'prefill', 'object'),
    ]) as [string, string, string | null, string | null, string | null, string | null];

    const variables = useVariableStore.getState().getVariablesForTemplate();
    const templateData: TemplateData = {
      config: this.buildConfigData(context),
      project: this.buildProjectData(context.projectId, context.sourceLanguage),
      input: {
        // userMessage is injected per user block in prepareMessages()
      },
      translation: {
        sourceLanguage: context.sourceLanguage,
        targetLanguage: context.targetLanguage,
        objectIds: context.objectsArray.map(o => o.objectId),
        contextObjectIds: context.contextObjectIds,
        currentTranslatedContents: context.currentTranslatedContents,
      },
      variables,
    };

    return {
      systemPrompt: renderTemplate(systemTemplate!, templateData),
      userPrompt: userTemplate!,  // NOT rendered - will be rendered per-message
      initialUserPrompt: initialTemplate ?? undefined,
      firstUserPrompt: firstTemplate ?? undefined,
      lastUserPrompt: lastTemplate ?? undefined,
      prefill: prefillTemplate && context.enablePrefill
        ? renderTemplate(prefillTemplate, templateData)
        : undefined,
      templateData,
    };
  }

  // ==================== Agent Translation ====================

  private static async generateAgentTranslationBundle(
    context: AgentTranslationPromptContext
  ): Promise<PromptBundle> {
    const [systemTemplate, userTemplate, prefillTemplate] = await Promise.all([
      this.getTemplate('translation', 'systemPrompt', 'message'),
      this.getTemplate('translation', 'userPrompt', 'message'),
      this.getTemplate('translation', 'prefill', 'message'),
    ]);

    const variables = useVariableStore.getState().getVariablesForTemplate();
    const templateData: TemplateData = {
      config: this.buildConfigData(context),
      project: this.buildProjectData(context.projectId, context.sourceLanguage),
      input: {
        // userMessage is injected per user block in prepareMessages()
      },
      translation: {
        sourceLanguage: context.sourceLanguage,
        targetLanguage: context.targetLanguage,
        messages: [{ id: 'source', content: context.sourceContent }],
      },
      variables,
    };

    return {
      systemPrompt: renderTemplate(systemTemplate!, templateData),
      userPrompt: renderTemplate(userTemplate!, templateData),
      prefill: prefillTemplate && context.enablePrefill
        ? renderTemplate(prefillTemplate, templateData)
        : undefined,
      templateData,
    };
  }

  // ==================== Agent Memory Summary ====================

  private static async generateAgentMemorySummaryBundle(
    context: AgentMemorySummaryPromptContext
  ): Promise<PromptBundle> {
    const [systemTemplate, userTemplate] = await Promise.all([
      this.getTemplate('agent', 'systemPrompt', 'memorySummary'),
      this.getTemplate('agent', 'userPrompt', 'memorySummary'),
    ]);

    const settings = useSettingsStore.getState().settings;
    const variables = useVariableStore.getState().getVariablesForTemplate();

    const templateData: TemplateData = {
      config: this.buildConfigData(context),
      project: this.buildProjectData(context.projectId, settings.mainLanguage),
      input: {
        // userMessage is injected per user block in prepareMessages()
      },
      memorySummary: context.memorySummary,
      variables,
    };

    return {
      systemPrompt: renderTemplate(systemTemplate!, templateData),
      userPrompt: userTemplate!, // NOT rendered - will be rendered per-message
      templateData,
    };
  }

  // ==================== Object Image Prompt ====================

  private static async generateObjectImagePromptBundle(
    context: ObjectImagePromptContext
  ): Promise<PromptBundle> {
    const [systemTemplate, userTemplate, initialTemplate, firstTemplate, lastTemplate, prefillTemplate] = await Promise.all([
      this.getTemplate('imagePrompt', 'systemPrompt', 'object'),
      this.getTemplate('imagePrompt', 'userPrompt', 'object'),
      this.getTemplate('imagePrompt', 'initialUserPrompt', 'object'),
      this.getTemplate('imagePrompt', 'firstUserPrompt', 'object'),
      this.getTemplate('imagePrompt', 'lastUserPrompt', 'object'),
      this.getTemplate('imagePrompt', 'prefill', 'object'),
    ]);

    const settings = useSettingsStore.getState().settings;
    const variables = useVariableStore.getState().getVariablesForTemplate();
    const templateData: TemplateData = {
      config: this.buildConfigData(context),
      project: this.buildProjectData(context.projectId, settings.mainLanguage),
      input: {
        // userMessage is injected per user block in prepareMessages()
      },
      imagePrompt: {
        objectType: context.objectType,
        objectInfo: context.objectInfo,
        promptMode: context.promptMode,
        currentPrompt: context.currentPrompt ?? undefined,
        currentPromptPositive: context.currentPromptPositive ?? undefined,
        currentPromptNegative: context.currentPromptNegative ?? undefined,
      },
      variables,
    };

    return {
      systemPrompt: renderTemplate(systemTemplate!, templateData),
      userPrompt: userTemplate!,  // NOT rendered - will be rendered per-message
      initialUserPrompt: initialTemplate ?? undefined,
      firstUserPrompt: firstTemplate ?? undefined,
      lastUserPrompt: lastTemplate ?? undefined,
      prefill: prefillTemplate && context.enablePrefill
        ? renderTemplate(prefillTemplate, templateData)
        : undefined,
      templateData,
    };
  }

  // ==================== Scene Image Prompt ====================

  private static async generateSceneImagePromptBundle(
    context: SceneImagePromptContext
  ): Promise<PromptBundle> {
    const [systemTemplate, userTemplate, initialTemplate, firstTemplate, lastTemplate, prefillTemplate] = await Promise.all([
      this.getTemplate('imagePrompt', 'systemPrompt', 'scene'),
      this.getTemplate('imagePrompt', 'userPrompt', 'scene'),
      this.getTemplate('imagePrompt', 'initialUserPrompt', 'scene'),
      this.getTemplate('imagePrompt', 'firstUserPrompt', 'scene'),
      this.getTemplate('imagePrompt', 'lastUserPrompt', 'scene'),
      this.getTemplate('imagePrompt', 'prefill', 'scene'),
    ]);

    const settings = useSettingsStore.getState().settings;
    const variables = useVariableStore.getState().getVariablesForTemplate();
    const templateData: TemplateData = {
      config: this.buildConfigData(context),
      project: this.buildProjectData(context.projectId, settings.mainLanguage),
      input: {
        // userMessage is injected per user block in prepareMessages()
      },
      imagePrompt: {
        promptMode: context.promptMode,
        scenePreContext: context.scenePreContext,
        scenePostContext: context.scenePostContext,
        selectedObjectIds: context.selectedObjects.map(o => o.id),
      },
      variables,
    };

    return {
      systemPrompt: renderTemplate(systemTemplate!, templateData),
      userPrompt: userTemplate!,  // NOT rendered - will be rendered per-message
      initialUserPrompt: initialTemplate ?? undefined,
      firstUserPrompt: firstTemplate ?? undefined,
      lastUserPrompt: lastTemplate ?? undefined,
      prefill: prefillTemplate && context.enablePrefill
        ? renderTemplate(prefillTemplate, templateData)
        : undefined,
      templateData,
    };
  }

  // ==================== Cover Image Prompt ====================

  private static async generateCoverImagePromptBundle(
    context: CoverImagePromptContext
  ): Promise<PromptBundle> {
    const [systemTemplate, userTemplate, initialTemplate, firstTemplate, lastTemplate, prefillTemplate] = await Promise.all([
      this.getTemplate('imagePrompt', 'systemPrompt', 'coverImage'),
      this.getTemplate('imagePrompt', 'userPrompt', 'coverImage'),
      this.getTemplate('imagePrompt', 'initialUserPrompt', 'coverImage'),
      this.getTemplate('imagePrompt', 'firstUserPrompt', 'coverImage'),
      this.getTemplate('imagePrompt', 'lastUserPrompt', 'coverImage'),
      this.getTemplate('imagePrompt', 'prefill', 'coverImage'),
    ]);

    const settings = useSettingsStore.getState().settings;
    const variables = useVariableStore.getState().getVariablesForTemplate();
    const templateData: TemplateData = {
      config: this.buildConfigData(context),
      project: this.buildProjectData(context.projectId, settings.mainLanguage),
      input: {
        // userMessage is injected per user block in prepareMessages()
      },
      imagePrompt: {
        promptMode: context.promptMode,
        selectedObjectIds: context.selectedObjects.map(o => o.id),
        currentPrompt: context.currentPrompt ?? undefined,
        currentPromptPositive: context.currentPromptPositive ?? undefined,
        currentPromptNegative: context.currentPromptNegative ?? undefined,
        coverImage: {
          title: context.basicInfo.title,
          logline: context.basicInfo.logline,
          genre: context.basicInfo.genre,
        },
      },
      variables,
    };

    return {
      systemPrompt: renderTemplate(systemTemplate!, templateData),
      userPrompt: userTemplate!,  // NOT rendered - will be rendered per-message
      initialUserPrompt: initialTemplate ?? undefined,
      firstUserPrompt: firstTemplate ?? undefined,
      lastUserPrompt: lastTemplate ?? undefined,
      prefill: prefillTemplate && context.enablePrefill
        ? renderTemplate(prefillTemplate, templateData)
        : undefined,
      templateData,
    };
  }

  // ==================== Helpers ====================

  private static buildConfigData(context: {
    thinkingMode?: ThinkingMode;
    enablePrefill?: boolean;
    outputMode?: OutputMode;
  }): TemplateData['config'] {
    const store = useSettingsStore.getState();
    const settings = store.settings;
    const outputMode = this.resolveOutputMode(context);

    return {
      mainLanguage: settings.mainLanguage,
      displayLanguage: settings.displayLanguage || settings.mainLanguage,
      today: new Date().toISOString().split('T')[0],
      thinkingMode: context.thinkingMode ?? 'off',
      isPrefillEnabled: context.enablePrefill ?? false,
      outputMode,
    };
  }

  /**
   * Helper to get data for a specific language from an object.
   * Falls back to first available language if requested language not found.
   */
  private static getObjectDataForLanguage(obj: UnifiedObject, language: string): Record<string, any> {
    if (obj.data[language]) {
      return obj.data[language];
    }
    const availableLanguages = Object.keys(obj.data);
    if (availableLanguages.length > 0) {
      return obj.data[availableLanguages[0]];
    }
    return {};
  }

  /**
   * Build project data from unifiedObjectStore for template rendering.
   * @param projectId - The project ID to filter objects by
   * @param language - The language to extract data for (mainLanguage)
   */
  static buildProjectData(projectId: string | undefined, language: string): TemplateData['project'] {
    if (!projectId) {
      throw new Error('projectId is required for buildProjectData. Ensure promptContext includes projectId.');
    }

    const store = useUnifiedObjectStore.getState();
    const allObjects = Object.values(store.objects);
    const projectObjects = allObjects.filter(
      obj => obj.metadata?.project_id === projectId
    );

    // Group by type
    const basicInfoList = projectObjects.filter(obj => obj.type === 'basic_info');
    const guidelinesList = projectObjects.filter(obj => obj.type === 'guidelines');
    const characters = projectObjects.filter(obj => obj.type === 'character');
    const organizations = projectObjects.filter(obj => obj.type === 'organization');
    const locations = projectObjects.filter(obj => obj.type === 'location');
    const lorebook = projectObjects.filter(obj => obj.type === 'lorebook');
    const acts = projectObjects.filter(obj => obj.type === 'act');
    const chapters = projectObjects.filter(obj => obj.type === 'chapter');
    const manuscripts = projectObjects.filter(obj => obj.type === 'manuscript');

    // Sort story objects by order within each type
    const sortByOrder = (a: UnifiedObject, b: UnifiedObject) =>
      (a.metadata?.order ?? Number.MAX_SAFE_INTEGER) - (b.metadata?.order ?? Number.MAX_SAFE_INTEGER);
    characters.sort(sortByOrder);
    organizations.sort(sortByOrder);
    locations.sort(sortByOrder);
    lorebook.sort(sortByOrder);

    // Build basic info
    if (basicInfoList.length !== 1) {
      throw new Error(`Expected exactly 1 basic_info for project ${projectId}, found ${basicInfoList.length}.`);
    }
    const basicInfoObj = basicInfoList[0];
    const basicInfo = (() => {
      const data = this.getObjectDataForLanguage(basicInfoObj, language);
      return {
        id: basicInfoObj.id,
        title: data.title || '',
        logline: data.logline || '',
        genre: data.genre || '',
      };
    })();

    // Build objects array (characters, organizations, locations, lorebook combined with type field)
    const objects: TemplateData['project']['objects'] = [
      ...characters.map(ch => {
        const data = this.getObjectDataForLanguage(ch, language);
        return {
          type: 'character',
          id: ch.id,
          name: data.name || '',
          description: data.description || '',
          content: data.content || '',
          imagePrompt: ch.metadata?.image_prompt || undefined,
          imagePromptPositive: ch.metadata?.image_prompt_positive || undefined,
          imagePromptNegative: ch.metadata?.image_prompt_negative || undefined,
        };
      }),
      ...organizations.map(org => {
        const data = this.getObjectDataForLanguage(org, language);
        return {
          type: 'organization',
          id: org.id,
          name: data.name || '',
          description: data.description || '',
          content: data.content || '',
          imagePrompt: org.metadata?.image_prompt || undefined,
          imagePromptPositive: org.metadata?.image_prompt_positive || undefined,
          imagePromptNegative: org.metadata?.image_prompt_negative || undefined,
        };
      }),
      ...locations.map(loc => {
        const data = this.getObjectDataForLanguage(loc, language);
        return {
          type: 'location',
          id: loc.id,
          name: data.name || '',
          description: data.description || '',
          content: data.content || '',
          imagePrompt: loc.metadata?.image_prompt || undefined,
          imagePromptPositive: loc.metadata?.image_prompt_positive || undefined,
          imagePromptNegative: loc.metadata?.image_prompt_negative || undefined,
        };
      }),
      ...lorebook.map(entry => {
        const data = this.getObjectDataForLanguage(entry, language);
        return {
          type: 'lorebook',
          id: entry.id,
          name: data.name || '',
          description: data.description || '',
          content: data.content || '',
          imagePrompt: entry.metadata?.image_prompt || undefined,
          imagePromptPositive: entry.metadata?.image_prompt_positive || undefined,
          imagePromptNegative: entry.metadata?.image_prompt_negative || undefined,
        };
      }),
    ];

    // Build outline with multiple outlines, acts and chapters
    const outlines = projectObjects.filter(obj => obj.type === 'outline');
    const outline: TemplateData['project']['outline'] = outlines.length > 0 ? {
      outlines: outlines
        .sort((a, b) => (a.metadata?.order || 0) - (b.metadata?.order || 0))
        .map(outlineObj => {
          const outlineData = this.getObjectDataForLanguage(outlineObj, language);
          const outlineActs = acts
            .filter(act => act.metadata?.outline_id === outlineObj.id)
            .sort((a, b) => (a.metadata?.order || 0) - (b.metadata?.order || 0));
          return {
            id: outlineObj.id,
            name: outlineData.name || '',
            description: outlineData.description || '',
            content: outlineData.content || '',
            order: (outlineObj.metadata?.order as number) || 0,
            acts: outlineActs.map(act => {
              const actData = this.getObjectDataForLanguage(act, language);
              return {
                id: act.id,
                name: actData.name || '',
                description: actData.description || '',
                content: actData.content || '',
                order: (act.metadata?.order as number) || 0,
                outlineId: outlineObj.id,
                chapters: chapters
                  .filter(ch => ch.metadata?.act_id === act.id)
                  .sort((a, b) => (a.metadata?.order || 0) - (b.metadata?.order || 0))
                  .map(chapter => {
                    const chapterData = this.getObjectDataForLanguage(chapter, language);
                    const manuscript = manuscripts.find(ms => ms.metadata?.chapter_id === chapter.id);
                    return {
                      id: chapter.id,
                      name: chapterData.name || '',
                      description: chapterData.description || '',
                      content: chapterData.content || '',
                      order: (chapter.metadata?.order as number) || 0,
                      actId: act.id,
                      manuscriptId: manuscript?.id || '',
                    };
                  }),
              };
            }),
          };
        }),
    } : null;

    // Build manuscripts array - sorted by chapter order
    const manuscriptList: TemplateData['project']['manuscripts'] = manuscripts
      .sort((a, b) => {
        const chapterA = chapters.find(ch => ch.id === a.metadata?.chapter_id);
        const chapterB = chapters.find(ch => ch.id === b.metadata?.chapter_id);
        const orderA = chapterA?.metadata?.order || 0;
        const orderB = chapterB?.metadata?.order || 0;
        return orderA - orderB;
      })
      .map(ms => {
      const data = this.getObjectDataForLanguage(ms, language);
      const chapterId = ms.metadata?.chapter_id || '';
      const chapter = chapters.find(ch => ch.id === chapterId);
      const chapterData = chapter ? this.getObjectDataForLanguage(chapter, language) : {};
      const doc = normalizeDoc((data as any).doc);
      const content = docToMarkdown(doc);
      const wordCount = typeof (data as any).wordCount === 'number' ? (data as any).wordCount : docWordCount(doc);
      return {
        id: ms.id,
        chapterId,
        chapterName: chapterData.name || '',
        content,
        wordCount,
      };
    });

    // Build languages - all languages including main
    const languages: TemplateData['project']['languages'] = {};

    // Collect all available languages from all objects
    const allLanguages = new Set<string>();
    projectObjects.forEach(obj => {
      Object.keys(obj.data || {}).forEach(lang => allLanguages.add(lang));
    });

    // Build data for ALL languages (including main)
    allLanguages.forEach(lang => {
      const langBasicInfo = (() => {
        const data = this.getObjectDataForLanguage(basicInfoObj, lang);
        return {
          id: basicInfoObj.id,
          title: data.title || '',
          logline: data.logline || '',
          genre: data.genre || '',
        };
      })();

      const langObjects = [
        ...characters.map(ch => {
          const data = ch.data[lang] || {};
          return {
            type: 'character',
            id: ch.id,
            name: data.name || '',
            description: data.description || '',
            content: data.content || '',
            imagePrompt: ch.metadata?.image_prompt || undefined,
            imagePromptPositive: ch.metadata?.image_prompt_positive || undefined,
            imagePromptNegative: ch.metadata?.image_prompt_negative || undefined,
          };
        }),
        ...organizations.map(org => {
          const data = org.data[lang] || {};
          return {
            type: 'organization',
            id: org.id,
            name: data.name || '',
            description: data.description || '',
            content: data.content || '',
            imagePrompt: org.metadata?.image_prompt || undefined,
            imagePromptPositive: org.metadata?.image_prompt_positive || undefined,
            imagePromptNegative: org.metadata?.image_prompt_negative || undefined,
          };
        }),
        ...locations.map(loc => {
          const data = loc.data[lang] || {};
          return {
            type: 'location',
            id: loc.id,
            name: data.name || '',
            description: data.description || '',
            content: data.content || '',
            imagePrompt: loc.metadata?.image_prompt || undefined,
            imagePromptPositive: loc.metadata?.image_prompt_positive || undefined,
            imagePromptNegative: loc.metadata?.image_prompt_negative || undefined,
          };
        }),
        ...lorebook.map(entry => {
          const data = entry.data[lang] || {};
          return {
            type: 'lorebook',
            id: entry.id,
            name: data.name || '',
            description: data.description || '',
            content: data.content || '',
            imagePrompt: entry.metadata?.image_prompt || undefined,
            imagePromptPositive: entry.metadata?.image_prompt_positive || undefined,
            imagePromptNegative: entry.metadata?.image_prompt_negative || undefined,
          };
        }),
        ...outlines.map(outlineObj => {
          const data = outlineObj.data[lang] || {};
          return {
            type: 'outline',
            id: outlineObj.id,
            name: data.name || '',
            description: data.description || '',
            content: data.content || '',
          };
        }),
        ...acts
          .slice()
          .sort((a, b) => (a.metadata?.order || 0) - (b.metadata?.order || 0))
          .map(act => {
            const data = act.data[lang] || {};
            return {
              type: 'act',
              id: act.id,
              name: data.name || '',
              description: data.description || '',
              content: data.content || '',
            };
          }),
        ...chapters
          .slice()
          .sort((a, b) => (a.metadata?.order || 0) - (b.metadata?.order || 0))
          .map(chapter => {
            const data = chapter.data[lang] || {};
            return {
              type: 'chapter',
              id: chapter.id,
              name: data.name || '',
              description: data.description || '',
              content: data.content || '',
            };
          }),
      ];

      // Build outline for this language (multiple outlines)
      const langOutline = outlines.length > 0 ? {
        outlines: outlines
          .sort((a, b) => (a.metadata?.order || 0) - (b.metadata?.order || 0))
          .map(outlineObj => {
            const outlineData = outlineObj.data[lang] || {};
            const outlineActs = acts
              .filter(act => act.metadata?.outline_id === outlineObj.id)
              .sort((a, b) => (a.metadata?.order || 0) - (b.metadata?.order || 0));
            return {
              id: outlineObj.id,
              name: outlineData.name || '',
              description: outlineData.description || '',
              content: outlineData.content || '',
              order: (outlineObj.metadata?.order as number) || 0,
              acts: outlineActs.map(act => {
                const actData = act.data[lang] || {};
                return {
                  id: act.id,
                  name: actData.name || '',
                  description: actData.description || '',
                  content: actData.content || '',
                  order: (act.metadata?.order as number) || 0,
                  outlineId: outlineObj.id,
                  chapters: chapters
                    .filter(ch => ch.metadata?.act_id === act.id)
                    .sort((a, b) => (a.metadata?.order || 0) - (b.metadata?.order || 0))
                    .map(chapter => {
                      const chapterData = chapter.data[lang] || {};
                      const manuscript = manuscripts.find(ms => ms.metadata?.chapter_id === chapter.id);
                      return {
                        id: chapter.id,
                        name: chapterData.name || '',
                        description: chapterData.description || '',
                        content: chapterData.content || '',
                        order: (chapter.metadata?.order as number) || 0,
                        actId: act.id,
                        manuscriptId: manuscript?.id || '',
                      };
                    }),
                };
              }),
            };
          }),
      } : null;

      // Build manuscripts for this language
      const langManuscripts = manuscripts.map(ms => {
        const data = ms.data[lang] || {};
        const chapterId = ms.metadata?.chapter_id || '';
        const chapter = chapters.find(ch => ch.id === chapterId);
        const chapterData = chapter?.data[lang] || {};
        const doc = normalizeDoc((data as any).doc);
        const content = docToMarkdown(doc);
        return {
          id: ms.id,
          chapterId,
          chapterName: chapterData.name || '',
          content,
          wordCount: typeof (data as any).wordCount === 'number' ? (data as any).wordCount : docWordCount(doc),
        };
      });

      languages[lang] = {
        basicInfo: langBasicInfo,
        objects: langObjects,
        outline: langOutline,
        manuscripts: langManuscripts,
      };
    });

    // Build guidelines
    const guidelines: TemplateData['project']['guidelines'] = guidelinesList.length > 0
      ? (() => {
          const data = this.getObjectDataForLanguage(guidelinesList[0], language) as { authorNote?: string };
          return {
            authorNote: data?.authorNote || '',
          };
        })()
      : { authorNote: '' };

    return {
      basicInfo,
      objects,
      outline,
      manuscripts: manuscriptList,
      languages,
      guidelines,
    };
  }

  // ==================== Tool Schemas ====================

  private static getEditAssistantTools(
    mode: 'manuscript' | 'storyObject'
  ): ToolCallSchema[] | undefined {
    return mode === 'manuscript' ? MANUSCRIPT_EDIT_TOOLS : STORY_OBJECT_EDIT_TOOLS;
  }
}
