import type { FunctionCallSchema } from '../functionCall';
import { STORY_OBJECT_EDIT_FUNCTIONS, MANUSCRIPT_EDIT_FUNCTIONS, getFunctionsForSet } from '../functionCall';
import { OBJECT_IMAGE_PROMPT_FUNCTIONS } from './schemas/imagePromptFunctions';
import { renderTemplate, registerFragments, type PromptFragment } from '../templateEngine/engine';
import { useSettingsStore } from '../store/settingsStore';
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import { fragmentService } from '../api/fragmentService';
import type { UnifiedObject } from '../types/unifiedObject';
import {
  LLMTaskMode,
  type LLMTaskModeType,
  type PromptBundle,
  type PromptContext,
  type TemplateData,
  type AgentWorkspacePromptContext,
  type AgentNovelEditorPromptContext,
  type AgentOutlineManagerPromptContext,
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
    category: 'systemPrompt' | 'prefill' | 'userPrompt' | 'nonLastUserPrompt',
    name?: string
  ): Promise<string | null> {
    const store = useSettingsStore.getState();

    const cached = store.getPromptFromCache(functionType, category as any, name);
    if (cached) {
      return cached;
    }

    try {
      return await store.loadPrompt(functionType, category as any, name);
    } catch (error) {
      if (category === 'nonLastUserPrompt') {
        return null;
      }
      console.error('Failed to load prompt:', error);
      throw new Error(`No prompt template found for ${functionType}/${category}/${name || 'default'}`);
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

    switch (mode) {
      case LLMTaskMode.AGENT_STORYOBJECT:
        return this.generateAgentBundle(context as AgentWorkspacePromptContext, 'storyObject');
      case LLMTaskMode.AGENT_NOVEL_EDITOR:
        return this.generateAgentBundle(context as AgentNovelEditorPromptContext, 'novelEditor');
      case LLMTaskMode.AGENT_OUTLINE_MANAGER:
        return this.generateAgentBundle(context as AgentOutlineManagerPromptContext, 'outlineManager');
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

  static getFunctionsForMode(
    mode: LLMTaskModeType,
    context: PromptContext
  ): FunctionCallSchema[] | undefined {
    switch (mode) {
      case LLMTaskMode.AGENT_STORYOBJECT:
      case LLMTaskMode.AGENT_NOVEL_EDITOR:
      case LLMTaskMode.AGENT_OUTLINE_MANAGER:
        return (context as AgentWorkspacePromptContext).functions;
      case LLMTaskMode.EDIT_ASSISTANT_STORY_OBJECT:
        return this.getEditAssistantFunctions(context as EditAssistantStoryObjectPromptContext, 'storyObject');
      case LLMTaskMode.EDIT_ASSISTANT_MANUSCRIPT:
        return this.getEditAssistantFunctions(context as EditAssistantManuscriptPromptContext, 'manuscript');
      case LLMTaskMode.TRANSLATION:
        return getFunctionsForSet('translateObjects');
      case LLMTaskMode.AGENT_TRANSLATION:
        return undefined;
      case LLMTaskMode.OBJECT_IMAGE_PROMPT:
        return this.getObjectImagePromptFunctions(context as ObjectImagePromptContext);
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
    const [systemTemplate, userTemplate, nonLastTemplate, prefillTemplate] = await Promise.all([
      this.getTemplate('agent', 'systemPrompt', mode),
      this.getTemplate('agent', 'userPrompt', mode),
      this.getTemplate('agent', 'nonLastUserPrompt', mode),
      this.getTemplate('agent', 'prefill', mode),
    ]);

    const settings = useSettingsStore.getState().settings;
    const templateData: TemplateData = {
      config: this.buildConfigData(context),
      project: this.buildProjectData(context.projectId, settings.mainLanguage),
      input: {
        userMessage: context.userInput,
      },
      agent: { mode, contextObjectIds: context.contextObjectIds },
    };

    return {
      systemPrompt: renderTemplate(systemTemplate!, templateData),
      userPrompt: userTemplate ? renderTemplate(userTemplate, templateData) : context.userInput,
      nonLastUserPrompt: nonLastTemplate ?? undefined,
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
    const [systemTemplate, userTemplate, prefillTemplate] = await Promise.all([
      this.getTemplate('editAssistant', 'systemPrompt', mode),
      this.getTemplate('editAssistant', 'userPrompt', mode),
      this.getTemplate('editAssistant', 'prefill', mode),
    ]);

    const settings = useSettingsStore.getState().settings;

    let templateData: TemplateData;

    if (mode === 'manuscript') {
      const msContext = context as EditAssistantManuscriptPromptContext;
      templateData = {
        config: this.buildConfigData(context),
        project: this.buildProjectData(context.projectId, settings.mainLanguage),
        input: { userMessage: context.userInput },
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
      };
    } else {
      const soContext = context as EditAssistantStoryObjectPromptContext;
      templateData = {
        config: this.buildConfigData(context),
        project: this.buildProjectData(context.projectId, settings.mainLanguage),
        input: { userMessage: context.userInput },
        editAssistant: {
          mode: 'storyObject',
          storyObject: {
            targetIds: soContext.targetIds,
            contextIds: soContext.contextIds,
            categoryName: soContext.categoryName,
            editScope: soContext.editScope,
          },
        },
      };
    }

    return {
      systemPrompt: renderTemplate(systemTemplate!, templateData),
      userPrompt: renderTemplate(userTemplate!, templateData),
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
    let prefillTemplate: string | null;

    try {
      [systemTemplate, userTemplate, prefillTemplate] = await Promise.all([
        this.getTemplate('translation', 'systemPrompt', 'object'),
        this.getTemplate('translation', 'userPrompt', 'object'),
        this.getTemplate('translation', 'prefill', 'object'),
      ]) as [string, string, string | null];
    } catch {
      [systemTemplate, userTemplate, prefillTemplate] = await Promise.all([
        this.getTemplate('translation', 'systemPrompt'),
        this.getTemplate('translation', 'userPrompt'),
        this.getTemplate('translation', 'prefill'),
      ]) as [string, string, string | null];
    }

    const templateData: TemplateData = {
      config: this.buildConfigData(context),
      project: this.buildProjectData(context.projectId, context.sourceLanguage),
      input: { userMessage: context.userInput },
      translation: {
        sourceLanguage: context.sourceLanguage,
        targetLanguage: context.targetLanguage,
        objectIds: context.objectsArray.map(o => o.objectId),
        contextObjectIds: context.contextObjectIds,
        currentTranslatedContents: context.currentTranslatedContents,
      },
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

  // ==================== Agent Translation ====================

  private static async generateAgentTranslationBundle(
    context: AgentTranslationPromptContext
  ): Promise<PromptBundle> {
    const [systemTemplate, userTemplate, prefillTemplate] = await Promise.all([
      this.getTemplate('translation', 'systemPrompt', 'agent'),
      this.getTemplate('translation', 'userPrompt', 'agent'),
      this.getTemplate('translation', 'prefill', 'agent'),
    ]);

    const templateData: TemplateData = {
      config: this.buildConfigData(context),
      project: this.buildProjectData(context.projectId, context.sourceLanguage),
      input: { userMessage: context.userInput },
      translation: {
        sourceLanguage: context.sourceLanguage,
        targetLanguage: context.targetLanguage,
        agentMessages: [{ id: 'source', content: context.sourceContent }],
      },
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

  // ==================== Object Image Prompt ====================

  private static async generateObjectImagePromptBundle(
    context: ObjectImagePromptContext
  ): Promise<PromptBundle> {
    const [systemTemplate, userTemplate, prefillTemplate] = await Promise.all([
      this.getTemplate('imagePrompt', 'systemPrompt', 'object'),
      this.getTemplate('imagePrompt', 'userPrompt', 'object'),
      this.getTemplate('imagePrompt', 'prefill', 'object'),
    ]);

    const settings = useSettingsStore.getState().settings;
    const templateData: TemplateData = {
      config: this.buildConfigData(context),
      project: this.buildProjectData(context.projectId, settings.mainLanguage),
      input: { userMessage: context.userInput },
      imagePrompt: {
        objectType: context.objectType,
        objectInfo: context.objectInfo,
        promptMode: context.promptMode,
        currentPrompt: context.currentPrompt ?? undefined,
        currentPromptPositive: context.currentPromptPositive ?? undefined,
        currentPromptNegative: context.currentPromptNegative ?? undefined,
      },
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

  // ==================== Scene Image Prompt ====================

  private static async generateSceneImagePromptBundle(
    context: SceneImagePromptContext
  ): Promise<PromptBundle> {
    const [systemTemplate, userTemplate, prefillTemplate] = await Promise.all([
      this.getTemplate('imagePrompt', 'systemPrompt', 'scene'),
      this.getTemplate('imagePrompt', 'userPrompt', 'scene'),
      this.getTemplate('imagePrompt', 'prefill', 'scene'),
    ]);

    const settings = useSettingsStore.getState().settings;
    const templateData: TemplateData = {
      config: this.buildConfigData(context),
      project: this.buildProjectData(context.projectId, settings.mainLanguage),
      input: { userMessage: context.userInput },
      imagePrompt: {
        promptMode: context.promptMode,
        scenePreContext: context.scenePreContext,
        scenePostContext: context.scenePostContext,
        selectedObjectIds: context.selectedObjects.map(o => o.id),
      },
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

  // ==================== Cover Image Prompt ====================

  private static async generateCoverImagePromptBundle(
    context: CoverImagePromptContext
  ): Promise<PromptBundle> {
    const [systemTemplate, userTemplate, prefillTemplate] = await Promise.all([
      this.getTemplate('imagePrompt', 'systemPrompt', 'coverImage'),
      this.getTemplate('imagePrompt', 'userPrompt', 'coverImage'),
      this.getTemplate('imagePrompt', 'prefill', 'coverImage'),
    ]);

    const settings = useSettingsStore.getState().settings;
    const templateData: TemplateData = {
      config: this.buildConfigData(context),
      project: this.buildProjectData(context.projectId, settings.mainLanguage),
      input: { userMessage: context.userInput },
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

  // ==================== Helpers ====================

  private static buildConfigData(context: {
    enableThinking?: boolean;
    enableCustomThinking?: boolean;
    enablePrefill?: boolean;
    isNativeOutput?: boolean;
  }): TemplateData['config'] {
    const store = useSettingsStore.getState();
    const settings = store.settings;

    return {
      mainLanguage: settings.mainLanguage,
      displayLanguage: settings.displayLanguage || settings.mainLanguage,
      today: new Date().toISOString().split('T')[0],
      isThinkingEnabled: context.enableThinking ?? false,
      isPrefillEnabled: context.enablePrefill ?? false,
      isCustomThinkingEnabled: context.enableCustomThinking ?? false,
      isNativeOutputMode: context.isNativeOutput ?? false,
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
  private static buildProjectData(projectId: string | undefined, language: string): TemplateData['project'] {
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
    const basicInfo = basicInfoList.length > 0 ? (() => {
      const data = this.getObjectDataForLanguage(basicInfoList[0], language);
      return {
        id: basicInfoList[0].id,
        title: data.title || '',
        logline: data.logline || '',
        genre: data.genre || '',
      };
    })() : null;

    // Build objects array (characters, organizations, locations, lorebook combined with type field)
    const objects: TemplateData['project']['objects'] = [
      ...characters.map(ch => {
        const data = this.getObjectDataForLanguage(ch, language);
        return {
          type: 'character',
          id: ch.id,
          name: data.name || '',
          description: data.description || '',
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
            order: (outlineObj.metadata?.order as number) || 0,
            acts: outlineActs.map(act => {
              const actData = this.getObjectDataForLanguage(act, language);
              return {
                id: act.id,
                name: actData.name || '',
                description: actData.description || '',
                order: (act.metadata?.order as number) || 0,
                outlineId: outlineObj.id,
                chapters: chapters
                  .filter(ch => ch.metadata?.act_id === act.id)
                  .sort((a, b) => (a.metadata?.order || 0) - (b.metadata?.order || 0))
                  .map(chapter => {
                    const chapterData = this.getObjectDataForLanguage(chapter, language);
                    return {
                      id: chapter.id,
                      name: chapterData.name || '',
                      description: chapterData.description || '',
                      order: (chapter.metadata?.order as number) || 0,
                      actId: act.id,
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
      return {
        id: ms.id,
        chapterId,
        chapterName: chapterData.name || '',
        content: data.content || '',
        wordCount: (data.content || '').length,
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
      const langBasicInfo = basicInfoList.length > 0 ? (() => {
        const data = this.getObjectDataForLanguage(basicInfoList[0], lang);
        return {
          id: basicInfoList[0].id,
          title: data.title || '',
          logline: data.logline || '',
          genre: data.genre || '',
        };
      })() : null;

      const langObjects = [
        ...characters.map(ch => {
          const data = ch.data[lang] || {};
          return {
            type: 'character',
            id: ch.id,
            name: data.name || '',
            description: data.description || '',
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
            imagePrompt: entry.metadata?.image_prompt || undefined,
            imagePromptPositive: entry.metadata?.image_prompt_positive || undefined,
            imagePromptNegative: entry.metadata?.image_prompt_negative || undefined,
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
              order: (outlineObj.metadata?.order as number) || 0,
              acts: outlineActs.map(act => {
                const actData = act.data[lang] || {};
                return {
                  id: act.id,
                  name: actData.name || '',
                  description: actData.description || '',
                  order: (act.metadata?.order as number) || 0,
                  outlineId: outlineObj.id,
                  chapters: chapters
                    .filter(ch => ch.metadata?.act_id === act.id)
                    .sort((a, b) => (a.metadata?.order || 0) - (b.metadata?.order || 0))
                    .map(chapter => {
                      const chapterData = chapter.data[lang] || {};
                      return {
                        id: chapter.id,
                        name: chapterData.name || '',
                        description: chapterData.description || '',
                        order: (chapter.metadata?.order as number) || 0,
                        actId: act.id,
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
        return {
          id: ms.id,
          chapterId,
          chapterName: chapterData.name || '',
          content: data.content || '',
          wordCount: (data.content || '').length,
        };
      });

      languages[lang] = {
        basicInfo: langBasicInfo,
        objects: langObjects,
        outline: langOutline,
        manuscripts: langManuscripts,
      };
    });

    return {
      basicInfo,
      objects,
      outline,
      manuscripts: manuscriptList,
      languages,
    };
  }

  // ==================== Function Schemas ====================

  private static getEditAssistantFunctions(
    context: EditAssistantStoryObjectPromptContext | EditAssistantManuscriptPromptContext,
    mode: 'manuscript' | 'storyObject'
  ): FunctionCallSchema[] | undefined {
    if (context.isNativeOutput) return undefined;
    return mode === 'manuscript' ? MANUSCRIPT_EDIT_FUNCTIONS : STORY_OBJECT_EDIT_FUNCTIONS;
  }

  private static getObjectImagePromptFunctions(
    context: ObjectImagePromptContext
  ): FunctionCallSchema[] | undefined {
    if (context.isNativeOutput) return undefined;
    return OBJECT_IMAGE_PROMPT_FUNCTIONS;
  }
}
