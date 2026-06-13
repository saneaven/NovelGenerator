import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { BaseModal } from '../BaseModal';
import './TranslationModal.css';
import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import { useSettings } from '../../store/settingsStore';
import type { AnyObjectType, TranslationStatus, UnifiedObject } from '../../types/unifiedObject';
import { getJourneySpec } from '../../llmTaskJourney/journeySpecs';
import { useJourneyStore } from '../../store/journeyStore';
import { journeyService } from '../../api/journeyService';
import { timelineService } from '../../api/timelineService';
import { translationService } from '../../api/unifiedObjectService';
import { Globe, Swap, Document } from '../icons';
import { ObjectPicker } from '../ObjectPicker';
import CollapsibleSection from '../ui/CollapsibleSection';
import { TextButton } from '../TextButton';
import { IconButton } from '../IconButton';
import ToggleSwitch from '../common/ToggleSwitch';
import {
  getStoryEntityFolderData,
} from '../../types/storyEntityFolder';
import { getProjectStoryEntityFolders } from '../../utils/storyEntityTree';
import { getAnyObjectTypeLabel, type FullTimeline, type TimelineTrack } from '../../types/timeline';
import { formatDate, toBaseUnits } from '../../utils/timelineCalendar';
import {
  buildTranslationStatusByObjectId,
  chooseTargetLanguageByMissingCount,
  hasLanguageForObject,
  shouldOfferObjectForTranslation,
} from './translationAvailability';

interface TranslationModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  defaultSourceLanguage?: string;
  defaultTargetLanguage?: string;
  defaultUserInput?: string;
  preSelectedObjectIds?: string[];  // If provided, skip tree selector and show only these objects
}

interface ProjectObjectToTranslate {
  objectType: AnyObjectType;
  objectKind?: UnifiedObject['kind'];
  objectId: string;
  sourceData: Record<string, any>;
  versionNumber?: number;
}

function objectDisplayLabel(objectType: AnyObjectType, objectKind?: UnifiedObject['kind']): string {
  if (objectType === 'story_entity_folder') {
    return 'Story Entity Folder';
  }
  if (objectType === 'story_entity') {
    if (!objectKind) return 'Story Entity';
    return `${objectKind[0].toUpperCase()}${objectKind.slice(1)} Entity`;
  }
  if (objectType === 'outline') {
    if (objectKind === 'act') return 'Act';
    if (objectKind === 'chapter') return 'Chapter';
    return 'Outline';
  }
  return getAnyObjectTypeLabel(objectType);
}

function getTimelineDataForLanguage(data: Record<string, Record<string, unknown>>, language: string): Record<string, any> {
  if (data[language]) return data[language] as Record<string, any>;
  const firstLanguage = Object.keys(data)[0];
  return firstLanguage ? (data[firstLanguage] as Record<string, any>) : {};
}

function forEachTimelineTrack(
  tracks: TimelineTrack[],
  visit: (track: TimelineTrack, path: number[]) => void,
  path: number[] = [],
): void {
  tracks.forEach((track, index) => {
    const nextPath = [...path, index];
    visit(track, nextPath);
    if (track.children.length > 0) {
      forEachTimelineTrack(track.children, visit, nextPath);
    }
  });
}

function timelinePathKey(path: number[]): string {
  return path.map((value) => String(value).padStart(3, '0')).join('');
}

function timelineBaseOrder(path: number[]): number {
  return 7_000_000 + Number(timelinePathKey(path) || '0') * 1_000;
}

function eventOrderValue(
  timeline: FullTimeline | null,
  path: number[],
  startDate: Record<string, number>,
  fallbackIndex: number,
): number {
  const base = timelineBaseOrder(path);
  if (!timeline) {
    return base + fallbackIndex;
  }
  try {
    return base + toBaseUnits(startDate, timeline.calendar) + fallbackIndex / 1000;
  } catch {
    return base + fallbackIndex;
  }
}

const TranslationModal: React.FC<TranslationModalProps> = ({
  isOpen,
  onClose,
  projectId,
  defaultSourceLanguage,
  defaultTargetLanguage,
  defaultUserInput,
  preSelectedObjectIds,
}) => {
  const [sourceLanguage, setSourceLanguage] = useState<string>(defaultSourceLanguage || '');
  const [targetLanguage, setTargetLanguage] = useState<string>(defaultTargetLanguage || '');
  const [userInput, setUserInput] = useState(defaultUserInput || '');

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isObjectsCollapsed, setIsObjectsCollapsed] = useState(false);

  // Context selection for target language reference
  const [selectedContextIds, setSelectedContextIds] = useState<Set<string>>(() => new Set());
  const [isContextCollapsed, setIsContextCollapsed] = useState(true);

  // Raw output mode
  const [rawMode, setRawMode] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [sourceTimeline, setSourceTimeline] = useState<FullTimeline | null>(null);
  const [targetTimeline, setTargetTimeline] = useState<FullTimeline | null>(null);
  const [translationStatuses, setTranslationStatuses] = useState<TranslationStatus[]>([]);
  const [translationStatusReady, setTranslationStatusReady] = useState(false);

  const hasInitializedSelectionRef = useRef(false);
  const hasInitializedContextRef = useRef(false);
  // Use selector to only subscribe to objects, preventing re-renders from unrelated store changes
  const objects = useUnifiedObjectStore(useShallow(state => state.objects));
  const refreshProjectObjects = useUnifiedObjectStore((state) => state.refreshProjectObjects);
  const settings = useSettings();

  const projectFolders = useMemo(
    () => getProjectStoryEntityFolders(objects, projectId),
    [objects, projectId],
  );

  // Build available languages list
  const availableLanguages = useMemo(() => {
    const languages = [settings.mainLanguage];
    if (settings.subLanguages && settings.subLanguages.length > 0) {
      languages.push(...settings.subLanguages);
    }
    return [...new Set(languages)].filter(Boolean);
  }, [settings.mainLanguage, settings.subLanguages]);

  const translationStatusByObjectId = useMemo(
    () => buildTranslationStatusByObjectId(translationStatuses),
    [translationStatuses],
  );

  // Ensure all object types are available for translation selection without mutating the page timeline.
  useEffect(() => {
    if (!isOpen || !projectId) return;

    let cancelled = false;
    const sourceTimelineLanguage = sourceLanguage || defaultSourceLanguage || settings.mainLanguage || 'English';
    const targetTimelineLanguage = targetLanguage || defaultTargetLanguage || '';

    setPickerLoading(true);
    setTranslationStatusReady(false);

    void Promise.all([
      refreshProjectObjects(projectId, [
        'basic_info',
        'guidelines',
        'story_entity',
        'outline',
        'manuscript',
      ]),
      timelineService.getTimeline(projectId, sourceTimelineLanguage),
      targetTimelineLanguage
        ? timelineService.getTimeline(projectId, targetTimelineLanguage)
        : Promise.resolve(null),
      availableLanguages.length > 0
        ? translationService.getProjectTranslationStatus(projectId, availableLanguages)
        : Promise.resolve({ translation_status: [] }),
    ]).then(([, nextSourceTimeline, nextTargetTimeline, statusResult]) => {
      if (cancelled) return;
      setSourceTimeline(nextSourceTimeline);
      setTargetTimeline(nextTargetTimeline);
      setTranslationStatuses(statusResult.translation_status);
      setTranslationStatusReady(true);
    }).catch((err) => {
      console.error('Failed to preload objects for translation:', err);
      if (!cancelled) {
        setTranslationStatusReady(true);
      }
    }).finally(() => {
      if (!cancelled) {
        setPickerLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    availableLanguages,
    defaultSourceLanguage,
    defaultTargetLanguage,
    isOpen,
    projectId,
    refreshProjectObjects,
    settings.mainLanguage,
    sourceLanguage,
    targetLanguage,
  ]);

  // Get IDs of objects that have target language translations (for context reference)
  const contextObjectIds = useMemo((): string[] => {
    if (!targetLanguage || !translationStatusReady) return [];

    const ids = new Set<string>();
    const allObjects = Object.values(objects) as UnifiedObject<any>[];

    allObjects.forEach(obj => {
      if (obj.metadata?.project_id !== projectId) return;
      if (!hasLanguageForObject(translationStatusByObjectId, obj.id, obj.data, targetLanguage)) return;

      const objType = obj.type;
      // Skip manuscript and basic_info for context
      if (objType === 'basic_info') return;

      ids.add(obj.id);
    });

    projectFolders.forEach((folder) => {
      if (!hasLanguageForObject(translationStatusByObjectId, folder.id, folder.data, targetLanguage)) return;
      ids.add(folder.id);
    });

    if (targetTimeline) {
      forEachTimelineTrack(targetTimeline.tracks, (track) => {
        if (hasLanguageForObject(translationStatusByObjectId, track.id, track.data, targetLanguage)) {
          ids.add(track.id);
        }
        track.events.forEach((event) => {
          if (hasLanguageForObject(translationStatusByObjectId, event.id, event.data, targetLanguage)) {
            ids.add(event.id);
          }
        });
      });
    }

    return Array.from(ids);
  }, [objects, projectId, targetLanguage, translationStatusReady, translationStatusByObjectId, projectFolders, targetTimeline]);

  const hasAnyContext = contextObjectIds.length > 0;

  // Initialize languages from settings - detect which direction has objects to translate
  useEffect(() => {
    // Guard: only run when modal opens and languages not yet set
    // Also require mainLanguage to be non-empty to avoid infinite loop
    if (
      isOpen &&
      !sourceLanguage &&
      translationStatusReady &&
      settings.mainLanguage &&
      settings.subLanguages &&
      settings.subLanguages.length > 0
    ) {
      const bestTargetLanguage = chooseTargetLanguageByMissingCount(
        translationStatuses,
        settings.subLanguages,
      );
      // Default: mainLanguage -> best sub language
      setSourceLanguage(settings.mainLanguage);
      setTargetLanguage(bestTargetLanguage);
    }
  }, [isOpen, settings.mainLanguage, settings.subLanguages, sourceLanguage, translationStatusReady, translationStatuses]);

  // Get all available objects that need translation (before selection filter)
  const availableObjects = useMemo(() => {
    if (!targetLanguage || !sourceLanguage) return [];

    const result: (ProjectObjectToTranslate & { label: string; order?: number })[] = [];
    const allObjects = Object.values(objects) as UnifiedObject<any>[];

    // When preSelectedObjectIds is provided, use those objects regardless of translation status
    const preSelectedSet = preSelectedObjectIds ? new Set(preSelectedObjectIds) : null;

    allObjects.forEach(obj => {
      if (obj.metadata?.project_id !== projectId) return;

      // If preSelectedObjectIds is provided, only include those specific objects
      const isPreSelected = Boolean(preSelectedSet?.has(obj.id));
      if (preSelectedSet) {
        if (!isPreSelected) return;
      }

      if (!shouldOfferObjectForTranslation({
        statusByObjectId: translationStatusByObjectId,
        objectId: obj.id,
        dataByLanguage: obj.data,
        sourceLanguage,
        targetLanguage,
        preSelected: isPreSelected,
      })) return;

      const objType = obj.type;
      if (objType === 'story_entity_folder') return; // handled by projectFolders.forEach with correct ordering

      const sourceData = obj.data[sourceLanguage] || obj.data[Object.keys(obj.data)[0]] || {};
      let label = sourceData.name || sourceData.title || obj.id;
      if (objType === 'guidelines') {
        label = getAnyObjectTypeLabel(objType) || label;
      }

      // Calculate hierarchical order for proper sorting
      let order = Number.MAX_SAFE_INTEGER;

      if (objType === 'story_entity') {
        order = obj.metadata.display_order ?? Number.MAX_SAFE_INTEGER - 1000;
      } else if (objType === 'outline') {
        const position = obj.metadata.position ?? 0;
        if (obj.kind === 'outline') {
          order = position * 1_000_000;
        } else if (obj.kind === 'act') {
          const outline = obj.metadata?.parent_id ? objects[obj.metadata.parent_id as string] : null;
          const outlinePosition = outline?.metadata?.position ?? 0;
          order = outlinePosition * 1_000_000 + position * 1_000;
        } else if (obj.kind === 'chapter') {
          const act = obj.metadata?.parent_id ? objects[obj.metadata.parent_id as string] : null;
          const outline = act?.metadata?.parent_id ? objects[act.metadata.parent_id as string] : null;
          const outlinePosition = outline?.metadata?.position ?? 0;
          const actPosition = act?.metadata?.position ?? 0;
          order = outlinePosition * 1_000_000 + actPosition * 1_000 + position;
        }
      } else if (objType === 'manuscript' && obj.metadata?.chapter_id) {
        const chapter = objects[obj.metadata.chapter_id as string];
        if (chapter) {
          const chapterData = chapter.data[sourceLanguage] || chapter.data[Object.keys(chapter.data)[0]];
          if (chapterData?.name) {
            label = chapterData.name;
          }
          const act = chapter.metadata?.parent_id ? objects[chapter.metadata.parent_id as string] : null;
          const outline = act?.metadata?.parent_id ? objects[act.metadata.parent_id as string] : null;
          const outlinePosition = outline?.metadata?.position ?? 0;
          const actPosition = act?.metadata?.position ?? 0;
          const chapterPosition = chapter.metadata?.position ?? 0;
          order = outlinePosition * 1_000_000 + actPosition * 1_000 + chapterPosition + 0.5;
        }
      }

      result.push({
        objectType: objType,
        objectKind: obj.kind,
        objectId: obj.id,
        sourceData,
        versionNumber: obj.version?.number,
        label,
        order,
      });
    });

    projectFolders.forEach((folder) => {
      const isPreSelected = Boolean(preSelectedSet?.has(folder.id));
      if (preSelectedSet) {
        if (!isPreSelected) return;
      }

      if (!shouldOfferObjectForTranslation({
        statusByObjectId: translationStatusByObjectId,
        objectId: folder.id,
        dataByLanguage: folder.data,
        sourceLanguage,
        targetLanguage,
        preSelected: isPreSelected,
      })) return;

      const sourceData = getStoryEntityFolderData(folder, sourceLanguage);
      result.push({
        objectType: 'story_entity_folder',
        objectId: folder.id,
        sourceData,
        versionNumber: folder.version?.number,
        label: sourceData.name || folder.id,
        order: folder.metadata.display_order ?? Number.MAX_SAFE_INTEGER - 2000,
      });
    });

    if (sourceTimeline) {
      forEachTimelineTrack(sourceTimeline.tracks, (track, path) => {
        const isTrackPreSelected = Boolean(preSelectedSet?.has(track.id));
        if (!(preSelectedSet && !isTrackPreSelected) && shouldOfferObjectForTranslation({
          statusByObjectId: translationStatusByObjectId,
          objectId: track.id,
          dataByLanguage: track.data,
          sourceLanguage,
          targetLanguage,
          preSelected: isTrackPreSelected,
        })) {
          const sourceData = getTimelineDataForLanguage(track.data, sourceLanguage);
          result.push({
            objectType: 'timeline_track',
            objectId: track.id,
            sourceData,
            versionNumber: track.version?.number,
            label: sourceData.name || `Track ${track.id}`,
            order: timelineBaseOrder(path),
          });
        }

        track.events.forEach((event, index) => {
          const isEventPreSelected = Boolean(preSelectedSet?.has(event.id));
          if (preSelectedSet && !isEventPreSelected) {
            return;
          }
          if (shouldOfferObjectForTranslation({
            statusByObjectId: translationStatusByObjectId,
            objectId: event.id,
            dataByLanguage: event.data,
            sourceLanguage,
            targetLanguage,
            preSelected: isEventPreSelected,
          })) {
            const sourceData = getTimelineDataForLanguage(event.data, sourceLanguage);
            const dateLabel = formatDate(event.startDate, sourceTimeline.calendar);
            result.push({
              objectType: 'timeline_event',
              objectId: event.id,
              sourceData,
              versionNumber: event.version?.number,
              label: sourceData.name || dateLabel,
              order: eventOrderValue(sourceTimeline, path, event.startDate, index),
            });
          }
        });
      });
    }

    // Sort by order for acts and chapters (objects without order will be at the end)
    return result.sort((a, b) => {
      const orderA = a.order ?? Number.MAX_SAFE_INTEGER;
      const orderB = b.order ?? Number.MAX_SAFE_INTEGER;
      return orderA - orderB;
    });
  }, [objects, projectId, targetLanguage, sourceLanguage, preSelectedObjectIds, projectFolders, sourceTimeline, translationStatusByObjectId]);

  // Get IDs of objects that need translation
  const availableObjectIds = useMemo(() => {
    return availableObjects.map(obj => obj.objectId);
  }, [availableObjects]);

  // Manage selectedIds: initialize on open, sync when objects change
  useEffect(() => {
    if (!isOpen) return;

    if (preSelectedObjectIds && preSelectedObjectIds.length > 0) {
      setSelectedIds(new Set(preSelectedObjectIds));
      hasInitializedSelectionRef.current = true;
      return;
    }

    if (!hasInitializedSelectionRef.current && availableObjectIds.length > 0) {
      // First time: select all
      setSelectedIds(new Set(availableObjectIds));
      hasInitializedSelectionRef.current = true;
    } else if (hasInitializedSelectionRef.current) {
      // Already initialized: just filter out stale IDs
      const availableSet = new Set(availableObjectIds);
      setSelectedIds(prev => {
        const filtered = new Set([...prev].filter(id => availableSet.has(id)));
        return filtered.size === prev.size ? prev : filtered;
      });
    }
  }, [isOpen, availableObjectIds, preSelectedObjectIds]);

  // Manage selectedContextIds: initialize on open, sync when context objects change
  useEffect(() => {
    if (!isOpen || pickerLoading) return;

    if (!hasInitializedContextRef.current && contextObjectIds.length > 0) {
      setSelectedContextIds(new Set(contextObjectIds));
      hasInitializedContextRef.current = true;
    } else if (hasInitializedContextRef.current) {
      const contextSet = new Set(contextObjectIds);
      setSelectedContextIds(prev => {
        const filtered = new Set([...prev].filter(id => contextSet.has(id)));
        return filtered.size === prev.size ? prev : filtered;
      });
    }
  }, [isOpen, contextObjectIds, pickerLoading]);

  // Get objects to translate based on selection
  const objectsToTranslate = useMemo((): ProjectObjectToTranslate[] => {
    return availableObjects.filter(obj => selectedIds.has(obj.objectId));
  }, [availableObjects, selectedIds]);

  // Determine if raw mode is available (single object, not basic_info)
  const canUseRawMode = useMemo(() => {
    if (objectsToTranslate.length !== 1) return false;
    const obj = objectsToTranslate[0];
    return obj.objectType !== 'basic_info' && obj.objectType !== 'guidelines';
  }, [objectsToTranslate]);

  // Reset rawMode when canUseRawMode becomes false
  useEffect(() => {
    if (!canUseRawMode && rawMode) {
      setRawMode(false);
    }
  }, [canUseRawMode, rawMode]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setUserInput(defaultUserInput || '');
      setSelectedIds(preSelectedObjectIds ? new Set(preSelectedObjectIds) : new Set());
      setSelectedContextIds(new Set());
      hasInitializedSelectionRef.current = false;
      hasInitializedContextRef.current = false;
      // Reset languages so they re-initialize from props on next open
      setSourceLanguage(defaultSourceLanguage || '');
      setTargetLanguage(defaultTargetLanguage || '');
      setRawMode(false);
      setSourceTimeline(null);
      setTargetTimeline(null);
      setTranslationStatuses([]);
      setTranslationStatusReady(false);
    }
  }, [isOpen, defaultSourceLanguage, defaultTargetLanguage, defaultUserInput, preSelectedObjectIds]);

  const handleStart = async () => {
    if (objectsToTranslate.length === 0) {
      return;
    }
    const spec = getJourneySpec('objectTranslation');
    const journeyId = crypto.randomUUID();
    const selectedObjectIds = objectsToTranslate.map((o) => o.objectId);
    const selectedContext = Array.from(selectedContextIds);
    const outputMode = rawMode
      ? 'raw_output'
      : (settings.nativeOutputMode ? 'native_tool_call' : 'tool_call');
    const inputPayload = {
      projectId,
      sourceLanguage,
      targetLanguage,
      userInput: userInput.trim() || undefined,
      objectIds: selectedObjectIds,
      contextObjectIds: selectedContext,
      rawMode,
      outputMode,
      translation: {
        sourceLanguage,
        targetLanguage,
        objectIds: selectedObjectIds,
        contextObjectIds: selectedContext,
        currentTranslatedContents: [],
      },
    };
    useJourneyStore.getState().createJourney({
      id: journeyId,
      kind: 'objectTranslation',
      input: inputPayload,
      editingTargets: spec.buildEditingTargets(inputPayload),
      label: spec.label(inputPayload),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    try {
      const created = await journeyService.create(projectId, {
        kind: 'objectTranslation',
        display_label: spec.label(inputPayload),
        input_text: userInput.trim() || 'Translate the selected objects.',
        input_payload: inputPayload,
        surface: 'story-entity',
        journey_target_ids: selectedObjectIds,
        context_object_ids: selectedContext,
        language: targetLanguage,
      });
      useJourneyStore.getState().updateJourney(journeyId, { threadId: created.thread_id });
    } catch (error: any) {
      useJourneyStore.getState().updateJourney(journeyId, {
        error: error?.message ?? 'Failed to start translation journey',
      });
    }

    // Auto-close modal - request continues in background, toast shows progress
    onClose();
  };

  const handleSwapLanguages = () => {
    const temp = sourceLanguage;
    setSourceLanguage(targetLanguage);
    setTargetLanguage(temp);
  };

  const handleSelectionChange = (ids: string[] | string) => {
    setSelectedIds(new Set(Array.isArray(ids) ? ids : [ids]));
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      size="medium"
      title={<><Globe size="xl" /> Translation</>}
      className="translation-modal"
      footer={
        <>
          <TextButton variant="secondary" onClick={onClose}>
            Cancel
          </TextButton>
          <TextButton
            variant="primary"
            onClick={handleStart}
            disabled={objectsToTranslate.length === 0 || !targetLanguage}
          >
            Start Translation
          </TextButton>
        </>
      }
    >
      <div className="translation-config">
        <div className="form-group">
          <label>Languages</label>
          <div className="language-selector-row">
            <select
              value={sourceLanguage}
              onChange={(e) => setSourceLanguage(e.target.value)}
              className="language-select"
            >
              {availableLanguages.map(lang => (
                <option key={lang} value={lang}>{lang}</option>
              ))}
            </select>
            <IconButton
              icon={<Swap size="md" />}
              onClick={handleSwapLanguages}
              title="Swap languages"
              size="sm"
            />
            <select
              value={targetLanguage}
              onChange={(e) => setTargetLanguage(e.target.value)}
              className="language-select"
            >
              {availableLanguages
                .filter(lang => lang !== sourceLanguage)
                .map(lang => (
                  <option key={lang} value={lang}>{lang}</option>
                ))}
            </select>
          </div>
        </div>

        {/* Pre-selected object display (when preSelectedObjectIds is provided) */}
        {preSelectedObjectIds && preSelectedObjectIds.length > 0 && availableObjects.length > 0 && (
          <div className="form-group">
            <label>Object to Translate</label>
            <div className="preselected-objects">
              {availableObjects.map(obj => (
                <div key={obj.objectId} className="preselected-object-item">
                  <span className="object-type-badge">{objectDisplayLabel(obj.objectType, obj.objectKind)}</span>
                  <span className="object-name">{obj.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tree-based object selector (when no preSelectedObjectIds) */}
        {!preSelectedObjectIds && availableObjectIds.length > 0 && (
          <CollapsibleSection
            label="Objects to Translate"
            expanded={!isObjectsCollapsed}
            onExpandChange={(expanded) => setIsObjectsCollapsed(!expanded)}
            selectedCount={selectedIds.size}
            totalCount={availableObjects.length}
            onToggleAll={(selectAll) => {
              if (selectAll) {
                setSelectedIds(new Set(availableObjectIds));
              } else {
                setSelectedIds(new Set());
              }
            }}
          >
            <ObjectPicker
              mode="translation"
              selectionMode="multi"
              selectedIds={Array.from(selectedIds)}
              onChange={handleSelectionChange}
              projectId={projectId}
              language={sourceLanguage}
              filterIds={availableObjectIds}
              loading={pickerLoading}
              timelineOverride={sourceTimeline}
              showSearch={false}
              maxHeight="300px"
              emptyMessage="No objects available for translation"
            />
          </CollapsibleSection>
        )}

        {canUseRawMode && (
          <div className="form-group raw-mode-toggle">
            <ToggleSwitch
              checked={rawMode}
              onChange={setRawMode}
              label="Raw output mode"
              icon={<Document size="sm" />}
            />
            <p className="field-hint">
              Output translation directly without tool calls.
            </p>
          </div>
        )}

        <div className="form-group">
          <label htmlFor="instructions">Additional Instructions (Optional)</label>
          <textarea
            id="instructions"
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            placeholder="e.g., Maintain formal tone, Use specific terminology..."
            rows={3}
          />
        </div>

        {/* Context Section - select already-translated objects as reference */}
        {hasAnyContext && (
          <CollapsibleSection
            label="Context (Target Language)"
            expanded={!isContextCollapsed}
            onExpandChange={(expanded) => setIsContextCollapsed(!expanded)}
            selectedCount={selectedContextIds.size}
            totalCount={contextObjectIds.length}
            onToggleAll={(selectAll) => {
              if (selectAll) {
                setSelectedContextIds(new Set(contextObjectIds));
              } else {
                setSelectedContextIds(new Set());
              }
            }}
          >
            <ObjectPicker
              mode="translation"
              selectionMode="multi"
              selectedIds={Array.from(selectedContextIds)}
              onChange={(ids) => {
                if (Array.isArray(ids)) {
                  setSelectedContextIds(new Set(ids));
                }
              }}
              projectId={projectId}
              language={targetLanguage}
              filterIds={contextObjectIds}
              loading={pickerLoading}
              timelineOverride={targetTimeline}
              showSearch={false}
              maxHeight="200px"
              emptyMessage="No translated objects available"
            />
          </CollapsibleSection>
        )}

        {/* Summary - only show for batch mode */}
        {!preSelectedObjectIds && (
          <div className="translation-summary">
            <strong>{objectsToTranslate.length}</strong> of <strong>{availableObjects.length}</strong> objects selected
          </div>
        )}
      </div>
    </BaseModal>
  );
};

export default TranslationModal;
