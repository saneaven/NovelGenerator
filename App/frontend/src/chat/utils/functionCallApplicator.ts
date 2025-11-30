import type { FunctionCallMetadata } from '../../llm_request/types';
import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import type { ObjectType, UnifiedObject } from '../../types/unifiedObject';
import { useSettingsStore } from '../../store/settingsStore';

type UnifiedObjectStore = ReturnType<typeof useUnifiedObjectStore.getState>;

export interface EditTagApplicationResult {
  success: boolean;
  message: string;
  error?: string;
}

type Handler = (projectId: string, args: any) => Promise<EditTagApplicationResult>;

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
    // Basic info
    create_basic_info: async (projectId, args) => {
      const { title, logline, genre } = args || {};
      if (!title || !logline || !genre) {
        return this.error('Missing required fields for basic info');
      }

      const existing = await this.store.listObjects('basic_info', projectId);
      if (existing.length > 0) {
        const basic = existing[0];
        await this.store.updateObject('basic_info', basic.id, {
          data: { title, logline, genre },
          language: this.language,
          create_new_version: true,
          user_request: 'AI Edit',
        });
        return this.ok('Updated basic info');
      }

      await this.store.createObject('basic_info', projectId, { title, logline, genre }, this.language, undefined, 'AI Edit');
      return this.ok('Created basic info');
    },

    update_basic_info: async (_projectId, args) => {
      const { id, title, logline, genre } = args || {};
      if (!id) return this.error('Missing id for update_basic_info');

      const object = await this.ensureObject('basic_info', id);
      const currentData = this.getObjectData(object);
      await this.store.updateObject('basic_info', id, {
        data: {
          title: title ?? currentData.title,
          logline: logline ?? currentData.logline,
          genre: genre ?? currentData.genre,
        },
        language: this.language,
        create_new_version: true,
        user_request: 'AI Edit',
      });
      return this.ok('Updated basic info');
    },

    // Characters
    create_character: async (projectId, args) =>
      this.createSimple('character', projectId, args),
    update_character: async (_projectId, args) =>
      this.updateSimple('character', args),
    delete_character: async (_projectId, args) =>
      this.deleteSimple('character', args),

    // Organizations
    create_organization: async (projectId, args) =>
      this.createSimple('organization', projectId, args),
    update_organization: async (_projectId, args) =>
      this.updateSimple('organization', args),
    delete_organization: async (_projectId, args) =>
      this.deleteSimple('organization', args),

    // Locations
    create_location: async (projectId, args) =>
      this.createSimple('location', projectId, args),
    update_location: async (_projectId, args) =>
      this.updateSimple('location', args),
    delete_location: async (_projectId, args) =>
      this.deleteSimple('location', args),

    // Lorebook
    create_lorebook_entry: async (projectId, args) =>
      this.createSimple('lorebook', projectId, args),
    update_lorebook_entry: async (_projectId, args) =>
      this.updateSimple('lorebook', args),
    delete_lorebook_entry: async (_projectId, args) =>
      this.deleteSimple('lorebook', args),

    // Acts
    create_act: async (projectId, args) => {
      const { name, description, order, chapters } = args || {};
      if (!name || !description) {
        return this.error('Missing name or description for act');
      }

      const acts = await this.store.listObjects('act', projectId);
      const actOrder = Number.isFinite(order) ? order : acts.length;

      const newAct = await this.store.createObject(
        'act',
        projectId,
        { name, description },
        this.language,
        { order: actOrder },
        'AI Edit'
      );

      if (Array.isArray(chapters)) {
        for (let i = 0; i < chapters.length; i += 1) {
          const ch = chapters[i];
          if (!ch) continue;
          const chapterOrder = Number.isFinite(ch.order) ? ch.order : i;
          await this.store.createObject(
            'chapter',
            projectId,
            {
              name: ch.name || '',
              description: ch.description || '',
            },
            this.language,
            { act_id: newAct.id, order: chapterOrder },
            'AI Edit'
          );
        }
      }

      return this.ok(`Created act "${name}"`);
    },

    update_act: async (_projectId, args) => {
      const { id, name, description } = args || {};
      if (!id) return this.error('Missing id for update_act');
      const object = await this.ensureObject('act', id);
      const currentData = this.getObjectData(object);

      await this.store.updateObject('act', id, {
        data: {
          name: name ?? currentData.name,
          description: description ?? currentData.description,
        },
        language: this.language,
        create_new_version: true,
        user_request: 'AI Edit',
      });

      return this.ok('Updated act');
    },

    delete_act: async (_projectId, args) => this.deleteSimple('act', args),

    // Chapters
    create_chapter: async (projectId, args) => {
      const { name, description, actId, order } = args || {};
      if (!name || !description || !actId) {
        return this.error('Missing required fields for create_chapter');
      }

      const chapters = await this.store.listObjects('chapter', projectId);
      const existingInAct = chapters.filter((ch: UnifiedObject) => ch.metadata?.act_id === actId);
      const chapterOrder = Number.isFinite(order) ? order : existingInAct.length;

      await this.store.createObject(
        'chapter',
        projectId,
        { name, description },
        this.language,
        { act_id: actId, order: chapterOrder },
        'AI Edit'
      );

      return this.ok(`Created chapter "${name}"`);
    },

    update_chapter: async (_projectId, args) => {
      const { id, name, description } = args || {};
      if (!id) return this.error('Missing id for update_chapter');

      const object = await this.ensureObject('chapter', id);
      const currentData = this.getObjectData(object);

      await this.store.updateObject('chapter', id, {
        data: {
          name: name ?? currentData.name,
          description: description ?? currentData.description,
        },
        language: this.language,
        create_new_version: true,
        user_request: 'AI Edit',
      });

      return this.ok('Updated chapter');
    },

    delete_chapter: async (_projectId, args) => this.deleteSimple('chapter', args),
  };

  // ------------------------------------------------------------------------ //
  // Helpers
  // ------------------------------------------------------------------------ //

  private async createSimple(type: ObjectType, projectId: string, args: any): Promise<EditTagApplicationResult> {
    const { name, description } = args || {};
    if (!name || !description) {
      return this.error(`Missing name or description for ${type}`);
    }

    await this.store.createObject(type, projectId, { name, description }, this.language, undefined, 'AI Edit');
    return this.ok(`Created ${type}: ${name}`);
  }

  private async updateSimple(type: ObjectType, args: any): Promise<EditTagApplicationResult> {
    const { id, name, description } = args || {};
    if (!id) return this.error(`Missing id for update_${type}`);

    const object = await this.ensureObject(type, id);
    const currentData = this.getObjectData(object);
    await this.store.updateObject(type, id, {
      data: {
        name: name ?? currentData.name,
        description: description ?? currentData.description,
      },
      language: this.language,
      create_new_version: true,
      user_request: 'AI Edit',
    });
    return this.ok(`Updated ${type}`);
  }

  private async deleteSimple(type: ObjectType, args: any): Promise<EditTagApplicationResult> {
    const { id } = args || {};
    if (!id) return this.error(`Missing id for delete_${type}`);
    await this.store.deleteObject(type, id);
    return this.ok(`Deleted ${type}`);
  }

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

  // Get object data for mainLanguage with fallback
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

