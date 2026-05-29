import React from 'react';
import type { ObjectOperationVM } from '../vmTypes';
import { TimelineTrackDisplay, type TimelineDisplayMode } from '../displays/TimelineTrackDisplay';
import { TimelineEventDisplay, type TimelineLinkReference } from '../displays/TimelineEventDisplay';
import { TimelineLinkDisplay } from '../displays/TimelineLinkDisplay';
import {
  asTagList,
  dataForLanguage,
  safeFormatDate,
  timelineName,
  type TimelineLookup,
} from './timelineCardData';

const EVENT_LINK_TOOLS = new Set(['create_timeline_event_link', 'delete_timeline_event_link']);

export function isTimelineObjectType(objectType: string): boolean {
  return objectType === 'timeline_track' || objectType === 'timeline_event';
}

export function isTimelineEventLink(toolName: string): boolean {
  return EVENT_LINK_TOOLS.has(toolName);
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

function asLinkRefs(value: unknown): TimelineLinkReference[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const linkId = asString(record.linkId) ?? asString(record.id);
    if (!linkId) return [];
    return [{
      linkId,
      objectType: asString(record.objectType),
      objectId: asString(record.objectId),
    }];
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
  const { operation, mode, lookup, language, values, changedFields, fallbackName } = params;
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
    ? asLinkRefs(fromArgs.links)
    : (stored?.links ?? []).map((link) => ({
        linkId: link.id,
        objectType: link.objectType,
        objectId: link.objectId,
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

/** Render the compact body for create/delete event-link tool calls. */
export function renderTimelineLink(params: {
  operation: ObjectOperationVM;
  mode: 'create' | 'delete';
  lookup: TimelineLookup;
  language: string;
}): React.ReactElement {
  const { operation, mode, lookup, language } = params;
  const args = operation.args;
  const eventId = asString(args.id) ?? operation.targetId;
  const event = lookup.findEvent(eventId);
  const eventLabel = timelineName(event?.data, language) ?? eventId ?? 'Event';

  let objectType = asString(args.objectType);
  let objectId = asString(args.objectId);

  // delete_timeline_event_link carries linkId; resolve via the stored event link.
  if (mode === 'delete' && !objectType) {
    const linkId = asString(args.linkId);
    const link = event?.links?.find((entry) => entry.id === linkId);
    if (link) {
      objectType = link.objectType;
      objectId = link.objectId;
    }
  }

  return (
    <TimelineLinkDisplay eventLabel={eventLabel} objectType={objectType} objectLabel={objectId} mode={mode} />
  );
}
