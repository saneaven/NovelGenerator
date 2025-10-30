/**
 * Edit Function Applicator
 * Handles applying edit function call results to the story object store
 */

import { useStoryObjectStore } from '../../store/storyObjectStore';
import type { FunctionCallMetadata } from '../../llm_request/types';

export interface FunctionApplicationResult {
  success: boolean;
  message: string;
  error?: string;
  data?: any;
}

/**
 * Apply edit function calls to the store
 */
export async function applyEditFunctionCalls(
  projectId: string,
  functionCalls: FunctionCallMetadata[]
): Promise<FunctionApplicationResult[]> {
  const results: FunctionApplicationResult[] = [];

  for (const functionCall of functionCalls) {
    try {
      const result = await applyEditFunctionCall(projectId, functionCall);
      results.push(result);
    } catch (error) {
      console.error('Function application error:', error);
      results.push({
        success: false,
        message: `Failed to apply ${functionCall.name}`,
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
  const store = useStoryObjectStore.getState();
  let args: any;

  // Parse arguments
  try {
    args = typeof functionCall.arguments === 'string'
      ? JSON.parse(functionCall.arguments)
      : functionCall.arguments;
  } catch (error) {
    return {
      success: false,
      message: `Invalid ${functionCall.name} arguments`,
      error: 'Failed to parse function arguments'
    };
  }

  // Route to appropriate handler
  switch (functionCall.name) {
    case 'edit_basic_info':
      return await handleEditBasicInfo(projectId, args, store);

    case 'edit_character':
      return await handleEditCharacter(projectId, args, store);

    case 'edit_organization':
      return await handleEditOrganization(projectId, args, store);

    case 'edit_location':
      return await handleEditLocation(projectId, args, store);

    case 'edit_lorebook_entry':
      return await handleEditLorebookEntry(projectId, args, store);

    case 'edit_act':
      return await handleEditAct(projectId, args, store);

    case 'edit_chapter_metadata':
      return await handleEditChapterMetadata(projectId, args, store);

    case 'edit_outline':
      return await handleEditOutline(projectId, args, store);

    case 'edit_characters_batch':
      return await handleEditCharactersBatch(projectId, args, store);

    case 'edit_organizations_batch':
      return await handleEditOrganizationsBatch(projectId, args, store);

    case 'edit_locations_batch':
      return await handleEditLocationsBatch(projectId, args, store);

    case 'edit_lorebook_batch':
      return await handleEditLorebookBatch(projectId, args, store);

    case 'edit_acts_batch':
      return await handleEditActsBatch(projectId, args, store);

    case 'edit_chapters_batch':
      return await handleEditChaptersBatch(projectId, args, store);

    default:
      return {
        success: false,
        message: `Unknown function: ${functionCall.name}`,
        error: `Function ${functionCall.name} is not supported`
      };
  }
}

// ============================================
// SINGLE ITEM HANDLERS
// ============================================

async function handleEditBasicInfo(
  projectId: string,
  args: { title: string; logline: string; genre: string },
  store: any
): Promise<FunctionApplicationResult> {
  await store.updateBasicInfo(projectId, {
    title: args.title,
    logline: args.logline,
    genre: args.genre
  });

  return {
    success: true,
    message: 'Basic info updated successfully',
    data: args
  };
}

async function handleEditCharacter(
  projectId: string,
  args: { id: string; name: string; description: string },
  store: any
): Promise<FunctionApplicationResult> {
  await store.updateCharacter(projectId, args.id, {
    name: args.name,
    description: args.description
  });

  return {
    success: true,
    message: 'Character updated successfully',
    data: args
  };
}

async function handleEditOrganization(
  projectId: string,
  args: { id: string; name: string; description: string },
  store: any
): Promise<FunctionApplicationResult> {
  await store.updateOrganization(projectId, args.id, {
    name: args.name,
    description: args.description
  });

  return {
    success: true,
    message: 'Organization updated successfully',
    data: args
  };
}

async function handleEditLocation(
  projectId: string,
  args: { id: string; name: string; description: string },
  store: any
): Promise<FunctionApplicationResult> {
  await store.updateLocation(projectId, args.id, {
    name: args.name,
    description: args.description
  });

  return {
    success: true,
    message: 'Location updated successfully',
    data: args
  };
}

async function handleEditLorebookEntry(
  projectId: string,
  args: { id: string; name: string; description: string },
  store: any
): Promise<FunctionApplicationResult> {
  await store.updateLorebookEntry(projectId, args.id, {
    name: args.name,
    description: args.description
  });

  return {
    success: true,
    message: 'Lorebook entry updated successfully',
    data: args
  };
}

async function handleEditAct(
  projectId: string,
  args: { id: string; name: string; description: string; chapters: any[] },
  store: any
): Promise<FunctionApplicationResult> {
  // Update act metadata
  await store.updateAct(projectId, args.id, {
    name: args.name,
    description: args.description
  });

  // Update chapters within the act
  for (const chapter of args.chapters) {
    if (chapter.id && chapter.id !== 'null' && chapter.id !== null) {
      // Update existing chapter
      await store.updateChapter(projectId, chapter.id, {
        name: chapter.name,
        description: chapter.description
      });
    } else {
      // Create new chapter
      await store.addChapter(projectId, args.id, chapter.name, chapter.description);
    }
  }

  return {
    success: true,
    message: 'Act updated successfully',
    data: args
  };
}

async function handleEditChapterMetadata(
  projectId: string,
  args: { id: string; name: string; description: string },
  store: any
): Promise<FunctionApplicationResult> {
  await store.updateChapter(projectId, args.id, {
    name: args.name,
    description: args.description
  });

  return {
    success: true,
    message: 'Chapter metadata updated successfully',
    data: args
  };
}

async function handleEditOutline(
  projectId: string,
  args: { acts: any[] },
  store: any
): Promise<FunctionApplicationResult> {
  // This is complex - we need to handle creates, updates, and implicit deletes
  // For now, we'll just update existing acts and create new ones
  // A full implementation would need to compare with existing outline

  for (const act of args.acts) {
    if (act.id && act.id !== 'null' && act.id !== null) {
      // Update existing act
      await store.updateAct(projectId, act.id, {
        name: act.name,
        description: act.description
      });

      // Update chapters
      for (const chapter of act.chapters || []) {
        if (chapter.id && chapter.id !== 'null' && chapter.id !== null) {
          await store.updateChapter(projectId, chapter.id, {
            name: chapter.name,
            description: chapter.description
          });
        } else {
          await store.addChapter(projectId, act.id, chapter.name, chapter.description);
        }
      }
    } else {
      // Create new act with chapters
      const response = await store.addAct(projectId, act.name, act.description, args.acts.indexOf(act));
      // Note: The addAct method would need to be updated to handle creating chapters at the same time
      // For now, this is a simplified implementation
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
  store: any
): Promise<FunctionApplicationResult> {
  const results = { updated: 0, created: 0 };

  for (const character of args.characters) {
    if (character.id && character.id !== 'null') {
      // Update existing
      await store.updateCharacter(projectId, character.id, {
        name: character.name,
        description: character.description
      });
      results.updated++;
    } else {
      // Create new
      await store.addCharacter(projectId, {
        name: character.name,
        description: character.description
      });
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
  store: any
): Promise<FunctionApplicationResult> {
  const results = { updated: 0, created: 0 };

  for (const org of args.organizations) {
    if (org.id && org.id !== 'null') {
      await store.updateOrganization(projectId, org.id, {
        name: org.name,
        description: org.description
      });
      results.updated++;
    } else {
      await store.addOrganization(projectId, {
        name: org.name,
        description: org.description
      });
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
  store: any
): Promise<FunctionApplicationResult> {
  const results = { updated: 0, created: 0 };

  for (const location of args.locations) {
    if (location.id && location.id !== 'null') {
      await store.updateLocation(projectId, location.id, {
        name: location.name,
        description: location.description
      });
      results.updated++;
    } else {
      await store.addLocation(projectId, {
        name: location.name,
        description: location.description
      });
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
  store: any
): Promise<FunctionApplicationResult> {
  const results = { updated: 0, created: 0 };

  for (const entry of args.entries) {
    if (entry.id && entry.id !== 'null') {
      await store.updateLorebookEntry(projectId, entry.id, {
        name: entry.name,
        description: entry.description
      });
      results.updated++;
    } else {
      await store.addLorebookEntry(projectId, {
        name: entry.name,
        description: entry.description
      });
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
  args: { acts: Array<{ id: string | null; name: string; description: string; chapters: any[] }> },
  store: any
): Promise<FunctionApplicationResult> {
  const results = { updated: 0, created: 0 };

  for (const act of args.acts) {
    if (act.id && act.id !== 'null') {
      // Update existing act
      await store.updateAct(projectId, act.id, {
        name: act.name,
        description: act.description
      });
      results.updated++;

      // Update chapters
      for (const chapter of act.chapters || []) {
        if (chapter.id && chapter.id !== 'null') {
          await store.updateChapter(projectId, chapter.id, {
            name: chapter.name,
            description: chapter.description
          });
        } else {
          await store.addChapter(projectId, act.id, chapter.name, chapter.description);
        }
      }
    } else {
      // Create new act
      await store.addAct(projectId, act.name, act.description, args.acts.indexOf(act));
      results.created++;
      // Note: Creating chapters for new acts would require knowing the new act ID
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
  args: { chapters: Array<{ id: string | null; actId?: string; name: string; description: string }> },
  store: any
): Promise<FunctionApplicationResult> {
  const results = { updated: 0, created: 0 };

  for (const chapter of args.chapters) {
    if (chapter.id && chapter.id !== 'null') {
      // Update existing chapter
      await store.updateChapter(projectId, chapter.id, {
        name: chapter.name,
        description: chapter.description
      });
      results.updated++;
    } else if (chapter.actId) {
      // Create new chapter (requires actId)
      await store.addChapter(projectId, chapter.actId, chapter.name, chapter.description);
      results.created++;
    }
  }

  return {
    success: true,
    message: `Chapters batch updated: ${results.updated} updated, ${results.created} created`,
    data: results
  };
}
