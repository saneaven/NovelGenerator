/**
 * Edit Function Applicator - Unified System
 * Handles applying edit function call results to the unified object store
 */

import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import { useSettingsStore } from '../../store/settingsStore';
import type { FunctionCallMetadata } from '../../llm_request/types';

export interface FunctionApplicationResult {
  success: boolean;
  message: string;
  error?: string;
  data?: any;
}

interface EditChapterPayload {
  id: string | null;
  name: string;
  description: string;
  order?: number;
  actId?: string | null;
}

interface EditActPayload {
  id: string;
  name: string;
  description: string;
  order?: number;
  chapters?: EditChapterPayload[];
}

type BatchActPayload = Omit<EditActPayload, 'id'> & { id: string | null };

/**
 * Apply edit function calls to the unified store
 */
export async function applyEditFunctionCalls(
  projectId: string,
  functionCalls: FunctionCallMetadata[]
): Promise<FunctionApplicationResult[]> {
  const results: FunctionApplicationResult[] = [];

  for (const functionCall of functionCalls) {
    const functionName = functionCall.function_name || (functionCall as any).name || 'unknown';
    try {
      const result = await applyEditFunctionCall(projectId, functionCall);
      results.push(result);
    } catch (error) {
      console.error('Function application error:', error);
      results.push({
        success: false,
        message: `Failed to apply ${functionName}`,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return results;
}

/**
 * Apply a single edit function call
 */
async function applyEditFunctionCall(
  projectId: string,
  functionCall: FunctionCallMetadata
): Promise<FunctionApplicationResult> {
  const functionName = functionCall.function_name || (functionCall as any).name || 'unknown';
  const store = useUnifiedObjectStore.getState();
  const settings = useSettingsStore.getState();
  let args: any;

  // Parse arguments
  try {
    const rawArgs = functionCall.arguments ?? (functionCall as any).function_arguments;
    args = typeof rawArgs === 'string'
      ? JSON.parse(rawArgs)
      : rawArgs;
  } catch (error) {
    return {
      success: false,
      message: `Invalid ${functionName ?? 'unknown'} arguments`,
      error: 'Failed to parse function arguments'
    };
  }

  // Route to appropriate handler
  switch (functionName) {
    case 'edit_basic_info':
      return await handleEditBasicInfo(projectId, args, store, settings);

    case 'edit_character':
      return await handleEditCharacter(projectId, args, store);

    case 'edit_organization':
      return await handleEditOrganization(projectId, args, store);

    case 'edit_location':
      return await handleEditLocation(projectId, args, store);

    case 'edit_lorebook':
      return await handleEditLorebookEntry(projectId, args, store);

    case 'edit_act':
      return await handleEditAct(projectId, args, store, settings);

    case 'edit_chapter_metadata':
      return await handleEditChapterMetadata(projectId, args, store);

    case 'edit_outline':
      return await handleEditOutline(projectId, args, store, settings);

    case 'edit_characters_batch':
      return await handleEditCharactersBatch(projectId, args, store, settings);

    case 'edit_organizations_batch':
      return await handleEditOrganizationsBatch(projectId, args, store, settings);

    case 'edit_locations_batch':
      return await handleEditLocationsBatch(projectId, args, store, settings);

    case 'edit_lorebook_batch':
      return await handleEditLorebookBatch(projectId, args, store, settings);

    case 'edit_acts_batch':
      return await handleEditActsBatch(projectId, args, store, settings);

    case 'edit_chapters_batch':
      return await handleEditChaptersBatch(projectId, args, store, settings);

    default:
      return {
        success: false,
        message: `Unknown function: ${functionName}`,
        error: `Function ${functionName} is not supported`
      };
  }
}

// ============================================
// SINGLE ITEM HANDLERS
// ============================================

async function handleEditBasicInfo(
  projectId: string,
  args: { title: string; logline: string; genre: string },
  store: any,
  settings: any
): Promise<FunctionApplicationResult> {
  // Get basic info object for this project
  const basicInfoList = await store.listObjects('basic_info', projectId);

  let basicInfoId: string;
  if (basicInfoList.length > 0) {
    basicInfoId = basicInfoList[0].id;
    const basicInfo = store.objects[basicInfoId];
    const language = basicInfo?.languages.active || settings.settings.mainLanguage;

    // Update existing basic info
    await store.updateObject('basic_info', basicInfoId, {
      data: {
        title: args.title,
        logline: args.logline,
        genre: args.genre
      },
      language,
      create_new_version: true,
      user_request: 'AI Edit',
    });
  } else {
    // Create new basic info
    const newBasicInfo = await store.createObject(
      'basic_info',
      projectId,
      {
        title: args.title,
        logline: args.logline,
        genre: args.genre
      },
      settings.settings.mainLanguage
    );
    basicInfoId = newBasicInfo.id;
  }

  return {
    success: true,
    message: 'Basic info updated successfully',
    data: args
  };
}

async function handleEditCharacter(
  _projectId: string,
  args: { id: string; name: string; description: string },
  store: any
): Promise<FunctionApplicationResult> {
  const character = store.objects[args.id];
  if (!character) {
    return {
      success: false,
      message: 'Character not found',
      error: `Character with id ${args.id} not found`
    };
  }

  await store.updateObject('character', args.id, {
    data: { name: args.name, description: args.description },
    language: character.languages.active,
    create_new_version: true,
    user_request: 'AI Edit',
  });

  return {
    success: true,
    message: 'Character updated successfully',
    data: args
  };
}

async function handleEditOrganization(
  _projectId: string,
  args: { id: string; name: string; description: string },
  store: any
): Promise<FunctionApplicationResult> {
  const organization = store.objects[args.id];
  if (!organization) {
    return {
      success: false,
      message: 'Organization not found',
      error: `Organization with id ${args.id} not found`
    };
  }

  await store.updateObject('organization', args.id, {
    data: { name: args.name, description: args.description },
    language: organization.languages.active,
    create_new_version: true,
    user_request: 'AI Edit',
  });

  return {
    success: true,
    message: 'Organization updated successfully',
    data: args
  };
}

async function handleEditLocation(
  _projectId: string,
  args: { id: string; name: string; description: string },
  store: any
): Promise<FunctionApplicationResult> {
  const location = store.objects[args.id];
  if (!location) {
    return {
      success: false,
      message: 'Location not found',
      error: `Location with id ${args.id} not found`
    };
  }

  await store.updateObject('location', args.id, {
    data: { name: args.name, description: args.description },
    language: location.languages.active,
    create_new_version: true,
    user_request: 'AI Edit',
  });

  return {
    success: true,
    message: 'Location updated successfully',
    data: args
  };
}

async function handleEditLorebookEntry(
  _projectId: string,
  args: { id: string; name: string; description: string },
  store: any
): Promise<FunctionApplicationResult> {
  const entry = store.objects[args.id];
  if (!entry) {
    return {
      success: false,
      message: 'Lorebook entry not found',
      error: `Lorebook entry with id ${args.id} not found`
    };
  }

  await store.updateObject('lorebook', args.id, {
    data: { name: args.name, description: args.description },
    language: entry.languages.active,
    create_new_version: true,
    user_request: 'AI Edit',
  });

  return {
    success: true,
    message: 'Lorebook entry updated successfully',
    data: args
  };
}

async function handleEditAct(
  projectId: string,
  args: EditActPayload,
  store: any,
  settings: any
): Promise<FunctionApplicationResult> {
  const existingAct = store.objects[args.id];
  if (!existingAct) {
    return {
      success: false,
      message: 'Act not found',
      error: `Act with id ${args.id} not found`
    };
  }

  // Update act metadata
  await store.updateObject('act', args.id, {
    data: {
      name: args.name,
      description: args.description
    },
    language: existingAct.languages.active,
    create_new_version: true,
    user_request: 'AI Edit',
  });

  // Handle chapters if provided
  const chapters = Array.isArray(args.chapters) ? args.chapters : [];

  for (let index = 0; index < chapters.length; index += 1) {
    const chapter = chapters[index];
    if (!chapter) {
      continue;
    }

    const chapterOrder = typeof chapter.order === 'number' && Number.isFinite(chapter.order)
      ? chapter.order
      : index;

    if (chapter.id && chapter.id !== 'null' && chapter.id !== null) {
      // Update existing chapter
      const existingChapter = store.objects[chapter.id];
      if (existingChapter) {
        await store.updateObject('chapter', chapter.id, {
          data: {
            name: chapter.name,
            description: chapter.description
          },
          language: existingChapter.languages.active,
          create_new_version: true,
          user_request: 'AI Edit',
        });
      }
    } else {
      // Create new chapter
      const targetActId = chapter.actId && chapter.actId !== 'null' && chapter.actId !== null
        ? chapter.actId
        : args.id;

      if (!targetActId) {
        continue;
      }

      await store.createObject(
        'chapter',
        projectId,
        {
          name: chapter.name,
          description: chapter.description
        },
        settings.settings.mainLanguage,
        {
          act_id: targetActId,
          order: chapterOrder
        }
      );
    }
  }

  return {
    success: true,
    message: 'Act updated successfully',
    data: args
  };
}

async function handleEditChapterMetadata(
  _projectId: string,
  args: { id: string; name: string; description: string },
  store: any
): Promise<FunctionApplicationResult> {
  const chapter = store.objects[args.id];
  if (!chapter) {
    return {
      success: false,
      message: 'Chapter not found',
      error: `Chapter with id ${args.id} not found`
    };
  }

  await store.updateObject('chapter', args.id, {
    data: {
      name: args.name,
      description: args.description
    },
    language: chapter.languages.active,
    create_new_version: true,
    user_request: 'AI Edit',
  });

  return {
    success: true,
    message: 'Chapter metadata updated successfully',
    data: args
  };
}

async function handleEditOutline(
  projectId: string,
  args: { acts: BatchActPayload[] },
  store: any,
  settings: any
): Promise<FunctionApplicationResult> {
  const acts = Array.isArray(args.acts) ? args.acts : [];

  for (let actIndex = 0; actIndex < acts.length; actIndex += 1) {
    const act = acts[actIndex];
    if (!act) {
      continue;
    }

    const actOrder = typeof act.order === 'number' && Number.isFinite(act.order)
      ? act.order
      : actIndex;

    if (act.id && act.id !== 'null' && act.id !== null) {
      // Update existing act
      const existingAct = store.objects[act.id];
      if (existingAct) {
        await store.updateObject('act', act.id, {
          data: {
            name: act.name,
            description: act.description
          },
          language: existingAct.languages.active,
          create_new_version: true,
          user_request: 'AI Edit',
        });

        // Update chapters
        const chapters = Array.isArray(act.chapters) ? act.chapters : [];

        for (let chapterIndex = 0; chapterIndex < chapters.length; chapterIndex += 1) {
          const chapter = chapters[chapterIndex];
          if (!chapter) {
            continue;
          }

          const chapterOrder = typeof chapter.order === 'number' && Number.isFinite(chapter.order)
            ? chapter.order
            : chapterIndex;

          if (chapter.id && chapter.id !== 'null' && chapter.id !== null) {
            const existingChapter = store.objects[chapter.id];
            if (existingChapter) {
              await store.updateObject('chapter', chapter.id, {
                data: {
                  name: chapter.name,
                  description: chapter.description
                },
                language: existingChapter.languages.active,
                create_new_version: true,
                user_request: 'AI Edit',
              });
            }
          } else {
            const targetActId = chapter.actId && chapter.actId !== 'null' && chapter.actId !== null
              ? chapter.actId
              : act.id;

            if (!targetActId) {
              continue;
            }

            await store.createObject(
              'chapter',
              projectId,
              {
                name: chapter.name,
                description: chapter.description
              },
              settings.settings.mainLanguage,
              {
                act_id: targetActId,
                order: chapterOrder
              }
            );
          }
        }
      }
    } else {
      // Create new act with chapters
      const newAct = await store.createObject(
        'act',
        projectId,
        {
          name: act.name,
          description: act.description
        },
        settings.settings.mainLanguage,
        {
          order: actOrder
        }
      );

      const chapters = Array.isArray(act.chapters) ? act.chapters : [];

      for (let chapterIndex = 0; chapterIndex < chapters.length; chapterIndex += 1) {
        const chapter = chapters[chapterIndex];
        if (!chapter) {
          continue;
        }

        const chapterOrder = typeof chapter.order === 'number' && Number.isFinite(chapter.order)
          ? chapter.order
          : chapterIndex;

        const targetActId = chapter.actId && chapter.actId !== 'null' && chapter.actId !== null
          ? chapter.actId
          : newAct.id;

        if (!targetActId) {
          continue;
        }

        await store.createObject(
          'chapter',
          projectId,
          {
            name: chapter.name,
            description: chapter.description
          },
          settings.settings.mainLanguage,
          {
            act_id: targetActId,
            order: chapterOrder
          }
        );
      }
    }
  }

  return {
    success: true,
    message: 'Outline updated successfully',
    data: args
  };
}

// ============================================
// BATCH HANDLERS
// ============================================

async function handleEditCharactersBatch(
  projectId: string,
  args: { characters: Array<{ id: string | null; name: string; description: string }> },
  store: any,
  settings: any
): Promise<FunctionApplicationResult> {
  const results = { updated: 0, created: 0 };

  for (const character of args.characters) {
    if (character.id && character.id !== 'null') {
      // Update existing
      const existingChar = store.objects[character.id];
      if (existingChar) {
        await store.updateObject('character', character.id, {
          data: {
            name: character.name,
            description: character.description
          },
          language: existingChar.languages.active,
          create_new_version: true,
          user_request: 'AI Edit',
        });
        results.updated++;
      }
    } else {
      // Create new
      await store.createObject(
        'character',
        projectId,
        {
          name: character.name,
          description: character.description
        },
        settings.settings.mainLanguage
      );
      results.created++;
    }
  }

  return {
    success: true,
    message: `Characters batch updated: ${results.updated} updated, ${results.created} created`,
    data: results
  };
}

async function handleEditOrganizationsBatch(
  projectId: string,
  args: { organizations: Array<{ id: string | null; name: string; description: string }> },
  store: any,
  settings: any
): Promise<FunctionApplicationResult> {
  const results = { updated: 0, created: 0 };

  for (const org of args.organizations) {
    if (org.id && org.id !== 'null') {
      const existingOrg = store.objects[org.id];
      if (existingOrg) {
        await store.updateObject('organization', org.id, {
          data: {
            name: org.name,
            description: org.description
          },
          language: existingOrg.languages.active,
          create_new_version: true,
          user_request: 'AI Edit',
        });
        results.updated++;
      }
    } else {
      await store.createObject(
        'organization',
        projectId,
        {
          name: org.name,
          description: org.description
        },
        settings.settings.mainLanguage
      );
      results.created++;
    }
  }

  return {
    success: true,
    message: `Organizations batch updated: ${results.updated} updated, ${results.created} created`,
    data: results
  };
}

async function handleEditLocationsBatch(
  projectId: string,
  args: { locations: Array<{ id: string | null; name: string; description: string }> },
  store: any,
  settings: any
): Promise<FunctionApplicationResult> {
  const results = { updated: 0, created: 0 };

  for (const location of args.locations) {
    if (location.id && location.id !== 'null') {
      const existingLoc = store.objects[location.id];
      if (existingLoc) {
        await store.updateObject('location', location.id, {
          data: {
            name: location.name,
            description: location.description
          },
          language: existingLoc.languages.active,
          create_new_version: true,
          user_request: 'AI Edit',
        });
        results.updated++;
      }
    } else {
      await store.createObject(
        'location',
        projectId,
        {
          name: location.name,
          description: location.description
        },
        settings.settings.mainLanguage
      );
      results.created++;
    }
  }

  return {
    success: true,
    message: `Locations batch updated: ${results.updated} updated, ${results.created} created`,
    data: results
  };
}

async function handleEditLorebookBatch(
  projectId: string,
  args: { entries: Array<{ id: string | null; name: string; description: string }> },
  store: any,
  settings: any
): Promise<FunctionApplicationResult> {
  const results = { updated: 0, created: 0 };

  for (const entry of args.entries) {
    if (entry.id && entry.id !== 'null') {
      const existingEntry = store.objects[entry.id];
      if (existingEntry) {
        await store.updateObject('lorebook', entry.id, {
          data: {
            name: entry.name,
            description: entry.description
          },
          language: existingEntry.languages.active,
          create_new_version: true,
          user_request: 'AI Edit',
        });
        results.updated++;
      }
    } else {
      await store.createObject(
        'lorebook',
        projectId,
        {
          name: entry.name,
          description: entry.description
        },
        settings.settings.mainLanguage
      );
      results.created++;
    }
  }

  return {
    success: true,
    message: `Lorebook batch updated: ${results.updated} updated, ${results.created} created`,
    data: results
  };
}

async function handleEditActsBatch(
  projectId: string,
  args: { acts: BatchActPayload[] },
  store: any,
  settings: any
): Promise<FunctionApplicationResult> {
  const results = { updated: 0, created: 0 };
  const acts = Array.isArray(args.acts) ? args.acts : [];

  for (let actIndex = 0; actIndex < acts.length; actIndex += 1) {
    const act = acts[actIndex];
    if (!act) {
      continue;
    }

    const actOrder = typeof act.order === 'number' && Number.isFinite(act.order)
      ? act.order
      : actIndex;

    if (act.id && act.id !== 'null') {
      // Update existing act
      const existingAct = store.objects[act.id];
      if (existingAct) {
        await store.updateObject('act', act.id, {
          data: {
            name: act.name,
            description: act.description
          },
          language: existingAct.languages.active,
          create_new_version: true,
          user_request: 'AI Edit',
        });
        results.updated++;

        // Update chapters
        const chapters = Array.isArray(act.chapters) ? act.chapters : [];

        for (let chapterIndex = 0; chapterIndex < chapters.length; chapterIndex += 1) {
          const chapter = chapters[chapterIndex];
          if (!chapter) {
            continue;
          }

          const chapterOrder = typeof chapter.order === 'number' && Number.isFinite(chapter.order)
            ? chapter.order
            : chapterIndex;

          if (chapter.id && chapter.id !== 'null') {
            const existingChapter = store.objects[chapter.id];
            if (existingChapter) {
              await store.updateObject('chapter', chapter.id, {
                data: {
                  name: chapter.name,
                  description: chapter.description
                },
                language: existingChapter.languages.active,
                create_new_version: true,
                user_request: 'AI Edit',
              });
            }
          } else {
            const targetActId = chapter.actId && chapter.actId !== 'null' && chapter.actId !== null
              ? chapter.actId
              : act.id;

            if (!targetActId) {
              continue;
            }

            await store.createObject(
              'chapter',
              projectId,
              {
                name: chapter.name,
                description: chapter.description
              },
              settings.settings.mainLanguage,
              {
                act_id: targetActId,
                order: chapterOrder
              }
            );
          }
        }
      }
    } else {
      // Create new act
      const newAct = await store.createObject(
        'act',
        projectId,
        {
          name: act.name,
          description: act.description
        },
        settings.settings.mainLanguage,
        {
          order: actOrder
        }
      );
      results.created++;

      const chapters = Array.isArray(act.chapters) ? act.chapters : [];

      for (let chapterIndex = 0; chapterIndex < chapters.length; chapterIndex += 1) {
        const chapter = chapters[chapterIndex];
        if (!chapter) {
          continue;
        }

        const chapterOrder = typeof chapter.order === 'number' && Number.isFinite(chapter.order)
          ? chapter.order
          : chapterIndex;

        const targetActId = chapter.actId && chapter.actId !== 'null' && chapter.actId !== null
          ? chapter.actId
          : newAct.id;

        if (!targetActId) {
          continue;
        }

        await store.createObject(
          'chapter',
          projectId,
          {
            name: chapter.name,
            description: chapter.description
          },
          settings.settings.mainLanguage,
          {
            act_id: targetActId,
            order: chapterOrder
          }
        );
      }
    }
  }

  return {
    success: true,
    message: `Acts batch updated: ${results.updated} updated, ${results.created} created`,
    data: results
  };
}

async function handleEditChaptersBatch(
  projectId: string,
  args: { chapters: Array<{ id: string | null; actId?: string | null; name: string; description: string; order?: number }> },
  store: any,
  settings: any
): Promise<FunctionApplicationResult> {
  const results = { updated: 0, created: 0 };
  const chapters = Array.isArray(args.chapters) ? args.chapters : [];

  for (let index = 0; index < chapters.length; index += 1) {
    const chapter = chapters[index];
    if (!chapter) {
      continue;
    }

    const chapterOrder = typeof chapter.order === 'number' && Number.isFinite(chapter.order)
      ? chapter.order
      : index;

    if (chapter.id && chapter.id !== 'null') {
      // Update existing chapter
      const existingChapter = store.objects[chapter.id];
      if (existingChapter) {
        await store.updateObject('chapter', chapter.id, {
          data: {
            name: chapter.name,
            description: chapter.description
          },
          language: existingChapter.languages.active,
          create_new_version: true,
          user_request: 'AI Edit',
        });
        results.updated++;
      }
    } else {
      const targetActId = chapter.actId && chapter.actId !== 'null' && chapter.actId !== null
        ? chapter.actId
        : null;
      if (!targetActId) {
        continue;
      }

      // Create new chapter (requires actId)
      await store.createObject(
        'chapter',
        projectId,
        {
          name: chapter.name,
          description: chapter.description
        },
        settings.settings.mainLanguage,
        {
          act_id: targetActId,
          order: chapterOrder
        }
      );
      results.created++;
    }
  }

  return {
    success: true,
    message: `Chapters batch updated: ${results.updated} updated, ${results.created} created`,
    data: results
  };
}
