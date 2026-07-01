import React from 'react';
import type { ObjectOperationVM } from '../vmTypes';
import type { UnifiedObject } from '../../../types/unifiedObject';
import { TimelineTrackDisplay, type TimelineDisplayMode } from '../displays/TimelineTrackDisplay';
import { TimelineEventDisplay, type TimelineLinkReference } from '../displays/TimelineEventDisplay';
import { resolveObjectName } from './helpers';
import {
  asTagList,
  dataForLanguage,
  safeFormatDate,
  timelineName,
  type TimelineLookup,
} from './timelineCardData';

export function isTimelineObjectType(objectType: string): boolean {
  return objectType === 'timeline_track' || objectType === 'timeline_event';
}

function asMarkdown(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? '').trim()).filter(Boolean);
}

function linkLabel(
  objectId: string | undefined,
  objects: Record<string, UnifiedObject>,
  language: string,
): string {
  return resolveObjectName(objects, objectId, language) ?? 'Unknown';
}

function asLinkRefs(
  value: unknown,
  objects: Record<string, UnifiedObject>,
  language: string,
): TimelineLinkReference[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const objectId = asString(record.objectId);
    if (!objectId) return [];
    return [{ label: linkLabel(objectId, objects, language) }];
  });
}

function resultObject(operation: ObjectOperationVM): Record<string, unknown> {
  const data = operation.result?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const object = (data as Record<string, unknown>).object;
  return object && typeof object === 'object' && !Array.isArray(object)
    ? object as Record<string, unknown>
    : {};
}

interface RenderParams {
  operation: ObjectOperationVM;
  mode: TimelineDisplayMode;
  lookup: TimelineLookup;
  objects: Record<string, UnifiedObject>;
  language: string;
  /** Field values for create/replace (from args / changed values). */
  values?: Record<string, unknown>;
  changedFields?: string[];
  /** Fallback display name resolved by the card (e.g. created object name). */
  fallbackName?: string;
}

function renderTrack(params: RenderParams): React.ReactElement {
  const { operation, mode, lookup, language, values, changedFields, fallbackName } = params;
  const fromArgs = values ?? (mode === 'read' ? resultObject(operation) : {});
  const stored = mode === 'read' || mode === 'delete' ? lookup.findTrack(operation.targetId) : undefined;
  const storedData = dataForLanguage(stored?.data, language);

  const name =
    asString(fromArgs.name) ?? timelineName(stored?.data, language) ?? fallbackName ?? operation.targetLabel ?? 'Track';
  const color = (fromArgs.color as string | null | undefined) ?? stored?.color ?? null;
  const position = typeof fromArgs.position === 'number' ? fromArgs.position : stored?.position;
  const parentId = (fromArgs.parentId as string | null | undefined) ?? stored?.parentId ?? null;
  const parentLabel =
    mode === 'read' || !parentId
      ? undefined
      : timelineName(lookup.findTrack(parentId)?.data, language) ?? undefined;
  const description = asString(fromArgs.description) ?? asString(storedData.description);
  const contentMarkdown = asMarkdown(fromArgs.content) ?? asMarkdown(storedData.content);
  const childTrackIds = asStringList(fromArgs.childTrackIds);
  const eventIds = asStringList(fromArgs.eventIds);

  return (
    <TimelineTrackDisplay
      name={name}
      color={color}
      parentId={parentId}
      parentLabel={parentLabel}
      position={position}
      description={description}
      contentMarkdown={contentMarkdown}
      childTrackIds={childTrackIds}
      eventIds={eventIds}
      mode={mode}
      changedFields={changedFields}
    />
  );
}

function renderEvent(params: RenderParams): React.ReactElement {
  const { operation, mode, lookup, objects, language, values, changedFields, fallbackName } = params;
  const fromArgs = values ?? (mode === 'read' ? resultObject(operation) : {});
  const stored = mode === 'read' || mode === 'delete' ? lookup.findEvent(operation.targetId) : undefined;
  const storedData = dataForLanguage(stored?.data, language);

  const trackId = (fromArgs.trackId as string | undefined) ?? stored?.trackId;
  const track = lookup.findTrack(trackId);
  const trackLabel =
    mode === 'read'
      ? trackId
      : track
        ? timelineName(track.data, language) ?? trackId
        : trackId;

  const name =
    asString(fromArgs.name) ?? timelineName(stored?.data, language) ?? fallbackName ?? operation.targetLabel ?? 'Event';
  const startLabel = safeFormatDate(fromArgs.startDate ?? stored?.startDate, lookup.calendar);
  const endValue = 'endDate' in fromArgs ? fromArgs.endDate : stored?.endDate;
  const endLabel = safeFormatDate(endValue, lookup.calendar);
  const tags = 'tags' in fromArgs ? asTagList(fromArgs.tags) : stored?.tags ?? [];
  const links = Array.isArray(fromArgs.links)
    ? asLinkRefs(fromArgs.links, objects, language)
    : (stored?.links ?? []).map((link) => ({
        label: linkLabel(link.objectId, objects, language),
      }));
  const description = asString(fromArgs.description) ?? asString(storedData.description);
  const contentMarkdown = asMarkdown(fromArgs.content) ?? asMarkdown(storedData.content);

  return (
    <TimelineEventDisplay
      name={name}
      trackColor={mode === 'read' ? null : track?.color ?? null}
      trackLabel={trackLabel}
      startLabel={startLabel}
      endLabel={endLabel}
      tags={tags}
      links={links}
      description={description}
      contentMarkdown={contentMarkdown}
      mode={mode}
      changedFields={changedFields}
    />
  );
}

/** Render the timeline-native body for a track/event tool call. */
export function renderTimelineBody(params: RenderParams): React.ReactElement {
  return params.operation.objectType === 'timeline_track' ? renderTrack(params) : renderEvent(params);
}
