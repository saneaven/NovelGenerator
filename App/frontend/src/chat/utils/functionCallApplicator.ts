/**
 * Function Call Applicator for Workspace Chat
 *
 * Handles applying function calls from the chat to the unified object store.
 * Supports the new replace/patch function structure:
 * - CRUD: create_story_object, delete_story_object, create_chapter, delete_chapter
 * - Replace: replace_basic_info, replace_story_object, replace_chapter, replace_manuscript
 * - Patch: patch_basic_info, patch_story_object, patch_chapter, patch_manuscript
 */

import type { FunctionCallMetadata } from '../../llm/requestTypes';
import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import type { ObjectType, UnifiedObject } from '../../types/unifiedObject';
import { useSettingsStore } from '../../store/settingsStore';
import type { PatchRetryContext, Replacement, StoryObjectType } from '../../types/patchTypes';
import { applyPatch } from '../../utils/patchUtils';

type UnifiedObjectStore = ReturnType<typeof useUnifiedObjectStore.getState>;

export interface EditTagApplicationResult {
  success: boolean;
  message: string;
  error?: string;
  /** Contexts for fields that need retry (patch failed) */
  retryContexts?: PatchRetryContext[];
}

type Handler = (projectId: string, args: any) => Promise<EditTagApplicationResult>;

/** Maps story object type to unified object type */
const STORY_OBJECT_TYPE_MAP: Record<StoryObjectType, ObjectType> = {
  character: 'character',
  location: 'location',
  item: 'lorebook',
  event: 'lorebook',
  act: 'act',
  other: 'lorebook',
};

export class FunctionCallApplicator {
  private store: UnifiedObjectStore;
  private language: string;

  constructor(store: UnifiedObjectStore) {
    this.store = store;
    this.language = useSettingsStore.getState().settings.mainLanguage;
  }

  async applyFunctionCall(
    projectId: string,
    functionCall: FunctionCallMetadata
  ): Promise<EditTagApplicationResult> {
    const args = typeof functionCall.arguments === 'string'
      ? this.safeParse(functionCall.arguments)
      : functionCall.arguments;

    const handler = this.handlers[functionCall.function_name];
    if (!handler) {
      return {
        success: false,
        message: 'Unknown function',
        error: `Unsupported function: ${functionCall.function_name}`,
      };
    }

    return handler(projectId, args || {});
  }

  // ------------------------------------------------------------------------ //
  // Handlers
  // ------------------------------------------------------------------------ //

  private handlers: Record<string, Handler> = {
    // ==================== CRUD ====================

    create_story_object: async (projectId, args) => {
      const { type, name, description } = args || {};
      if (!type || !name || !description) {
        return this.error('Missing required fields for create_story_object');
      }

      const objectType = STORY_OBJECT_TYPE_MAP[type as StoryObjectType];
      if (!objectType) {
        return this.error(`Unknown story object type: ${type}`);
      }

      // Special handling for acts
      if (type === 'act') {
        const acts = await this.store.listObjects('act', projectId);
        const order = acts.length;
        await this.store.createObject('act', projectId, { name, description }, this.language, { order }, 'AI Edit');
        return this.ok(`Created act: ${name}`);
      }

      await this.store.createObject(objectType, projectId, { name, description }, this.language, undefined, 'AI Edit');
      return this.ok(`Created ${type}: ${name}`);
    },

    delete_story_object: async (_projectId, args) => {
      const { id, type } = args || {};
      if (!id || !type) {
        return this.error('Missing id or type for delete_story_object');
      }

      const objectType = STORY_OBJECT_TYPE_MAP[type as StoryObjectType];
      if (!objectType) {
        return this.error(`Unknown story object type: ${type}`);
      }

      await this.store.deleteObject(objectType, id);
      return this.ok(`Deleted ${type}`);
    },

    create_chapter: async (projectId, args) => {
      const { actId, name, description } = args || {};
      if (!actId || !name || !description) {
        return this.error('Missing required fields for create_chapter');
      }

      const chapters = await this.store.listObjects('chapter', projectId);
      const existingInAct = chapters.filter((ch: UnifiedObject) => ch.metadata?.act_id === actId);
      const order = existingInAct.length;

      await this.store.createObject(
        'chapter',
        projectId,
        { name, description },
        this.language,
        { act_id: actId, order },
        'AI Edit'
      );

      return this.ok(`Created chapter: ${name}`);
    },

    delete_chapter: async (_projectId, args) => {
      const { id } = args || {};
      if (!id) {
        return this.error('Missing id for delete_chapter');
      }

      await this.store.deleteObject('chapter', id);
      return this.ok('Deleted chapter');
    },

    // ==================== Replace ====================

    replace_basic_info: async (projectId, args) => {
      const { title, logline, genre } = args || {};

      const existing = await this.store.listObjects('basic_info', projectId);
      if (existing.length > 0) {
        const basic = existing[0];
        const currentData = this.getObjectData(basic);

        await this.store.updateObject('basic_info', basic.id, {
          data: {
            title: title ?? currentData.title ?? '',
            logline: logline ?? currentData.logline ?? '',
            genre: genre ?? currentData.genre ?? '',
          },
          language: this.language,
          create_new_version: true,
          user_request: 'AI Edit',
        });
        return this.ok('Updated basic info');
      }

      await this.store.createObject(
        'basic_info',
        projectId,
        { title: title ?? '', logline: logline ?? '', genre: genre ?? '' },
        this.language,
        undefined,
        'AI Edit'
      );
      return this.ok('Created basic info');
    },

    replace_story_object: async (_projectId, args) => {
      const { id, type, name, description } = args || {};
      if (!id || !type) {
        return this.error('Missing id or type for replace_story_object');
      }

      const objectType = STORY_OBJECT_TYPE_MAP[type as StoryObjectType];
      if (!objectType) {
        return this.error(`Unknown story object type: ${type}`);
      }

      const object = await this.ensureObject(objectType, id);
      const currentData = this.getObjectData(object);

      await this.store.updateObject(objectType, id, {
        data: {
          name: name ?? currentData.name ?? '',
          description: description ?? currentData.description ?? '',
        },
        language: this.language,
        create_new_version: true,
        user_request: 'AI Edit',
      });

      return this.ok(`Updated ${type}`);
    },

    replace_chapter: async (_projectId, args) => {
      const { id, actId, name, description } = args || {};
      if (!id) {
        return this.error('Missing id for replace_chapter');
      }

      const object = await this.ensureObject('chapter', id);
      const currentData = this.getObjectData(object);

      const updateData: Record<string, unknown> = {
        name: name ?? currentData.name ?? '',
        description: description ?? currentData.description ?? '',
      };

      // Handle actId change if provided
      const metadata = actId ? { act_id: actId } : undefined;

      await this.store.updateObject('chapter', id, {
        data: updateData,
        language: this.language,
        create_new_version: true,
        user_request: 'AI Edit',
        ...(metadata && { metadata }),
      });

      return this.ok('Updated chapter');
    },

    replace_manuscript: async (projectId, args) => {
      const { chapterId, content } = args || {};
      if (!chapterId || content === undefined) {
        return this.error('Missing chapterId or content for replace_manuscript');
      }

      // Find or create manuscript for this chapter
      const manuscripts = await this.store.listObjects('manuscript', projectId);
      let manuscript = manuscripts.find((m: UnifiedObject) => m.metadata?.chapter_id === chapterId);

      if (!manuscript) {
        manuscript = await this.store.createObject(
          'manuscript',
          projectId,
          { content: '', wordCount: 0 },
          this.language,
          { chapter_id: chapterId },
          'AI Edit'
        );
      }

      const wordCount = content.trim().split(/\s+/).filter(Boolean).length;

      await this.store.updateObject('manuscript', manuscript.id, {
        data: { content, wordCount },
        language: this.language,
        create_new_version: true,
        user_request: 'AI Edit',
      });

      return this.ok('Updated manuscript');
    },

    // ==================== Patch ====================

    patch_basic_info: async (projectId, args) => {
      const { replacements } = args || {};
      if (!replacements || !Array.isArray(replacements)) {
        return this.error('Missing replacements for patch_basic_info');
      }

      const existing = await this.store.listObjects('basic_info', projectId);
      if (existing.length === 0) {
        return this.error('No basic info found to patch');
      }

      const basic = existing[0];
      const currentData = this.getObjectData(basic);
      const retryContexts: PatchRetryContext[] = [];

      // Apply patches to each field
      const newData: Record<string, string> = {
        title: currentData.title ?? '',
        logline: currentData.logline ?? '',
        genre: currentData.genre ?? '',
      };

      for (const r of replacements as Replacement[]) {
        if (!r.field || !newData.hasOwnProperty(r.field)) continue;

        const result = applyPatch(newData[r.field], [{ old: r.old, new: r.new }]);
        if (result.success) {
          newData[r.field] = result.value;
        } else {
          retryContexts.push({
            objectId: basic.id,
            fieldName: r.field,
            currentValue: newData[r.field],
            error: result.error || 'Patch failed',
          });
        }
      }

      await this.store.updateObject('basic_info', basic.id, {
        data: newData,
        language: this.language,
        create_new_version: true,
        user_request: 'AI Edit',
      });

      if (retryContexts.length > 0) {
        return {
          success: false,
          message: `Updated basic info with ${retryContexts.length} patch failure(s)`,
          retryContexts,
        };
      }
      return this.ok('Updated basic info');
    },

    patch_story_object: async (_projectId, args) => {
      const { id, type, replacements } = args || {};
      if (!id || !type || !replacements) {
        return this.error('Missing required fields for patch_story_object');
      }

      const objectType = STORY_OBJECT_TYPE_MAP[type as StoryObjectType];
      if (!objectType) {
        return this.error(`Unknown story object type: ${type}`);
      }

      const object = await this.ensureObject(objectType, id);
      const currentData = this.getObjectData(object);
      const retryContexts: PatchRetryContext[] = [];

      const newData: Record<string, string> = {
        name: currentData.name ?? '',
        description: currentData.description ?? '',
      };

      for (const r of replacements as Replacement[]) {
        if (!r.field || !newData.hasOwnProperty(r.field)) continue;

        const result = applyPatch(newData[r.field], [{ old: r.old, new: r.new }]);
        if (result.success) {
          newData[r.field] = result.value;
        } else {
          retryContexts.push({
            objectId: id,
            objectType: type,
            fieldName: r.field,
            currentValue: newData[r.field],
            error: result.error || 'Patch failed',
          });
        }
      }

      await this.store.updateObject(objectType, id, {
        data: newData,
        language: this.language,
        create_new_version: true,
        user_request: 'AI Edit',
      });

      if (retryContexts.length > 0) {
        return {
          success: false,
          message: `Updated ${type} with ${retryContexts.length} patch failure(s)`,
          retryContexts,
        };
      }
      return this.ok(`Updated ${type}`);
    },

    patch_chapter: async (_projectId, args) => {
      const { id, replacements } = args || {};
      if (!id || !replacements) {
        return this.error('Missing required fields for patch_chapter');
      }

      const object = await this.ensureObject('chapter', id);
      const currentData = this.getObjectData(object);
      const retryContexts: PatchRetryContext[] = [];

      const newData: Record<string, string> = {
        name: currentData.name ?? '',
        description: currentData.description ?? '',
      };

      for (const r of replacements as Replacement[]) {
        if (!r.field || !newData.hasOwnProperty(r.field)) continue;

        const result = applyPatch(newData[r.field], [{ old: r.old, new: r.new }]);
        if (result.success) {
          newData[r.field] = result.value;
        } else {
          retryContexts.push({
            objectId: id,
            objectType: 'chapter',
            fieldName: r.field,
            currentValue: newData[r.field],
            error: result.error || 'Patch failed',
          });
        }
      }

      await this.store.updateObject('chapter', id, {
        data: newData,
        language: this.language,
        create_new_version: true,
        user_request: 'AI Edit',
      });

      if (retryContexts.length > 0) {
        return {
          success: false,
          message: `Updated chapter with ${retryContexts.length} patch failure(s)`,
          retryContexts,
        };
      }
      return this.ok('Updated chapter');
    },

    patch_manuscript: async (projectId, args) => {
      const { chapterId, replacements } = args || {};
      if (!chapterId || !replacements) {
        return this.error('Missing required fields for patch_manuscript');
      }

      // Find manuscript for this chapter
      const manuscripts = await this.store.listObjects('manuscript', projectId);
      const manuscript = manuscripts.find((m: UnifiedObject) => m.metadata?.chapter_id === chapterId);

      if (!manuscript) {
        return this.error(`No manuscript found for chapter ${chapterId}`);
      }

      const currentData = this.getObjectData(manuscript);
      const currentContent = currentData.content ?? '';
      const retryContexts: PatchRetryContext[] = [];

      // Apply all replacements to content
      const result = applyPatch(currentContent, replacements as Array<{ old: string; new: string }>);

      if (!result.success) {
        retryContexts.push({
          objectId: manuscript.id,
          fieldName: 'content',
          currentValue: currentContent,
          error: result.error || 'Patch failed',
        });
      }

      const wordCount = result.value.trim().split(/\s+/).filter(Boolean).length;

      await this.store.updateObject('manuscript', manuscript.id, {
        data: { content: result.value, wordCount },
        language: this.language,
        create_new_version: true,
        user_request: 'AI Edit',
      });

      if (retryContexts.length > 0) {
        return {
          success: false,
          message: 'Updated manuscript with patch failure(s)',
          retryContexts,
        };
      }
      return this.ok('Updated manuscript');
    },
  };

  // ------------------------------------------------------------------------ //
  // Helpers
  // ------------------------------------------------------------------------ //

  private async ensureObject(type: ObjectType, id: string) {
    let object = this.store.getObject(id);
    if (!object) {
      await this.store.fetchObject(type, id);
      object = this.store.getObject(id);
    }
    if (!object) {
      throw new Error(`${type} with id ${id} not found`);
    }
    return object;
  }

  private getObjectData(object: UnifiedObject): Record<string, any> {
    const data = object.data[this.language];
    if (data) return data;
    const availableLanguages = Object.keys(object.data);
    if (availableLanguages.length > 0) {
      return object.data[availableLanguages[0]];
    }
    return {};
  }

  private ok(message: string): EditTagApplicationResult {
    return { success: true, message };
  }

  private error(message: string): EditTagApplicationResult {
    return { success: false, message, error: message };
  }

  private safeParse(raw: string): any {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
}
