import type { FunctionCallMetadata } from '../../llm_request/types';
import type { UnifiedObjectStore } from '../../store/unifiedObjectStore';
import type { ObjectType } from '../../types/unifiedObject';
import { useSettingsStore } from '../../store/settingsStore';

export interface EditTagApplicationResult {
  success: boolean;
  message: string;
  error?: string;
}

export class FunctionCallApplicator {
  private store: UnifiedObjectStore;

  constructor(store: UnifiedObjectStore) {
    this.store = store;
  }

  async applyFunctionCall(
    projectId: string,
    functionCall: FunctionCallMetadata
  ): Promise<EditTagApplicationResult> {
    try {
      switch (functionCall.function_name) {
        case 'manage_story_objects':
          return await this.applyManageStoryObjects(projectId, functionCall.arguments);
        default:
          return {
            success: false,
            message: 'Unknown function name',
            error: `Unsupported function: ${functionCall.function_name}`
          };
      }
    } catch (error) {
      return {
        success: false,
        message: 'Failed to apply function call',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }


  private async applyManageStoryObjects(
    projectId: string,
    args: any
  ): Promise<EditTagApplicationResult> {
    if (!args || !args.operations || !Array.isArray(args.operations)) {
      return {
        success: false,
        message: 'Invalid manage_story_objects arguments',
        error: 'Function must receive operations array'
      };
    }

    let processedCount = 0;
    const results: string[] = [];

    for (const operation of args.operations) {
      const { action, type, id, data } = operation;

      if (!action || !type) {
        results.push(`Skipped operation: missing action or type`);
        continue;
      }

      try {
        switch (action) {
          case 'create':
            await this.handleCreateOperation(projectId, type, data, results);
            processedCount++;
            break;
          case 'update':
            if (!id || !data) {
              results.push(`Skipped update operation for ${type}: missing id or data`);
              continue;
            }
            await this.handleUpdateOperation(projectId, type, id, data, results);
            processedCount++;
            break;
          case 'delete':
            if (!id) {
              results.push(`Skipped delete operation for ${type}: missing id`);
              continue;
            }
            await this.handleDeleteOperation(projectId, type, id, results);
            processedCount++;
            break;
          default:
            results.push(`Unknown action: ${action}`);
        }
      } catch (error) {
        results.push(`Error processing ${action} ${type}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    return {
      success: true,
      message: `Processed ${processedCount} operations: ${results.join(', ')}`
    };
  }

  private async handleCreateOperation(
    projectId: string,
    type: string,
    data: any,
    results: string[]
  ): Promise<void> {
    if (!data) {
      results.push(`Skipped create ${type}: missing data`);
      return;
    }

    const settings = useSettingsStore.getState();
    const language = settings.settings.primaryLanguage;

    // Map old type names to ObjectType
    let objectType: ObjectType;
    switch (type) {
      case 'basic_info':
        objectType = 'basic_info';
        break;
      case 'character':
        objectType = 'character';
        break;
      case 'organization':
        objectType = 'organization';
        break;
      case 'location':
        objectType = 'location';
        break;
      case 'lorebook':
        objectType = 'lorebook';
        break;
      case 'act':
        objectType = 'act';
        break;
      case 'chapter':
        objectType = 'chapter';
        break;
      default:
        results.push(`Unknown create type: ${type}`);
        return;
    }

    switch (objectType) {
      case 'basic_info': {
        // Get basic info for this project
        const basicInfoList = await this.store.listObjects('basic_info', projectId);

        if (basicInfoList.length > 0) {
          // Update existing
          const basicInfo = basicInfoList[0];
          await this.store.updateObject('basic_info', basicInfo.id, {
            data: {
              title: data.title || '',
              logline: data.logline || '',
              genre: data.genre || ''
            },
            language: basicInfo.languages.active,
            create_new_version: true,
            user_request: 'AI Edit',
          });
        } else {
          // Create new
          await this.store.createObject('basic_info', projectId, {
            title: data.title || '',
            logline: data.logline || '',
            genre: data.genre || ''
          }, language);
        }
        results.push(`Created/updated basic info`);
        break;
      }
      case 'character':
        await this.store.createObject('character', projectId, {
          name: data.name || '',
          description: data.description || ''
        }, language);
        results.push(`Created character: ${data.name}`);
        break;
      case 'organization':
        await this.store.createObject('organization', projectId, {
          name: data.name || '',
          description: data.description || ''
        }, language);
        results.push(`Created organization: ${data.name}`);
        break;
      case 'location':
        await this.store.createObject('location', projectId, {
          name: data.name || '',
          description: data.description || ''
        }, language);
        results.push(`Created location: ${data.name}`);
        break;
      case 'lorebook':
        await this.store.createObject('lorebook', projectId, {
          name: data.name || '',
          description: data.description || ''
        }, language);
        results.push(`Created lorebook entry: ${data.name}`);
        break;
      case 'act': {
        const acts = await this.store.listObjects('act', projectId);
        const actOrder = typeof data.order === 'number' && Number.isFinite(data.order)
          ? data.order
          : acts.length;

        const newAct = await this.store.createObject('act', projectId, {
          name: data.name || '',
          description: data.description || ''
        }, language, {
          order: actOrder
        });

        // Handle chapters within act if provided
        if (data.chapters && Array.isArray(data.chapters)) {
          for (let index = 0; index < data.chapters.length; index += 1) {
            const chapter = data.chapters[index];
            if (!chapter) {
              continue;
            }

            const chapterOrder = typeof chapter.order === 'number' && Number.isFinite(chapter.order)
              ? chapter.order
              : index;

            await this.store.createObject('chapter', projectId, {
              name: chapter.name || '',
              description: chapter.description || ''
            }, language, {
              act_id: newAct.id,
              order: chapterOrder
            });
          }
        }
        results.push(`Created act: ${data.name}`);
        break;
      }
      case 'chapter': {
        if (!data.actId) {
          results.push(`Skipped create chapter: missing actId`);
          return;
        }

        const chapters = await this.store.listObjects('chapter', projectId);
        const existingChapters = chapters.filter(ch => ch.metadata.act_id === data.actId);
        const chapterOrder = typeof data.order === 'number' && Number.isFinite(data.order)
          ? data.order
          : existingChapters.length;

        await this.store.createObject('chapter', projectId, {
          name: data.name || '',
          description: data.description || ''
        }, language, {
          act_id: data.actId,
          order: chapterOrder
        });
        results.push(`Created chapter: ${data.name}`);
        break;
      }
      default:
        results.push(`Unknown create type: ${type}`);
    }
  }

  private async handleUpdateOperation(
    projectId: string,
    type: string,
    id: string,
    data: any,
    results: string[]
  ): Promise<void> {
    const itemName = data.name || 'Unknown';

    // Map old type names to ObjectType
    let objectType: ObjectType;
    switch (type) {
      case 'basic_info':
        objectType = 'basic_info';
        break;
      case 'character':
        objectType = 'character';
        break;
      case 'organization':
        objectType = 'organization';
        break;
      case 'location':
        objectType = 'location';
        break;
      case 'lorebook':
        objectType = 'lorebook';
        break;
      case 'act':
        objectType = 'act';
        break;
      case 'chapter':
        objectType = 'chapter';
        break;
      default:
        results.push(`Unknown update type: ${type}`);
        return;
    }

    // Get the object
    const object = this.store.objects[id];
    if (!object) {
      results.push(`${type} with id ${id} not found`);
      return;
    }

    // Handle order for acts and chapters
    if (objectType === 'act' && (typeof data.order !== 'number' || !Number.isFinite(data.order))) {
      data.order = object.metadata.order;
    } else if (objectType === 'chapter' && (typeof data.order !== 'number' || !Number.isFinite(data.order))) {
      data.order = object.metadata.order;
      if (!data.actId) {
        data.actId = object.metadata.act_id;
      }
    }

    // Update the object
    const updateData: any = {};
    if (objectType === 'basic_info') {
      updateData.title = data.title !== undefined ? data.title : object.data.title;
      updateData.logline = data.logline !== undefined ? data.logline : object.data.logline;
      updateData.genre = data.genre !== undefined ? data.genre : object.data.genre;
    } else {
      updateData.name = data.name !== undefined ? data.name : object.data.name;
      updateData.description = data.description !== undefined ? data.description : object.data.description;
    }

    await this.store.updateObject(objectType, id, {
      data: updateData,
      language: object.languages.active,
      create_new_version: true,
      user_request: 'AI Edit',
    });

    const displayName = objectType === 'basic_info' ? 'basic info' : itemName;
    results.push(`Updated ${objectType}: ${displayName}`);
  }

  private async handleDeleteOperation(
    projectId: string,
    type: string,
    id: string,
    results: string[]
  ): Promise<void> {
    // Map old type names to ObjectType
    let objectType: ObjectType;
    switch (type) {
      case 'character':
        objectType = 'character';
        break;
      case 'organization':
        objectType = 'organization';
        break;
      case 'location':
        objectType = 'location';
        break;
      case 'lorebook':
        objectType = 'lorebook';
        break;
      case 'act':
        objectType = 'act';
        break;
      case 'chapter':
        objectType = 'chapter';
        break;
      default:
        results.push(`Unknown delete type: ${type}`);
        return;
    }

    // Get the object to get its name
    const object = this.store.objects[id];
    if (!object) {
      results.push(`${type} with id ${id} not found`);
      return;
    }

    const objectName = object.data.name || 'Unknown';

    // Delete the object
    await this.store.deleteObject(objectType, id);

    results.push(`Deleted ${objectType}: ${objectName}`);
  }

}
