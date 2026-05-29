import React from 'react';
import type { ObjectOperationVM } from '../vmTypes';
import { TimelineTrackDisplay, type TimelineDisplayMode } from '../displays/TimelineTrackDisplay';
import { TimelineEventDisplay } from '../displays/TimelineEventDisplay';
import { TimelineLinkDisplay } from '../displays/TimelineLinkDisplay';
import {
  asTagList,
  dataForLanguage,
  safeFormatDate,
  timelineName,
  type TimelineLookup,
} from './timelineCardData';
import type { TimelineEvent, TimelineTrack } from '../../../types/timeline';

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
  const fromArgs = values ?? {};
  const stored = mode === 'read' || mode === 'delete' ? lookup.findTrack(operation.targetId) : undefined;
  const storedData = dataForLanguage(stored?.data, language);

  const name =
    asString(fromArgs.name) ?? timelineName(stored?.data, language) ?? fallbackName ?? operation.targetLabel ?? 'Track';
  const color = (fromArgs.color as string | null | undefined) ?? stored?.color ?? null;
  const position = typeof fromArgs.position === 'number' ? fromArgs.position : stored?.position;
  const parentId = (fromArgs.parentId as string | null | undefined) ?? stored?.parentId ?? null;
  const parentLabel = parentId ? timelineName(lookup.findTrack(parentId)?.data, language) ?? undefined : undefined;
  const description = asString(fromArgs.description) ?? asString(storedData.description);
  const contentMarkdown = asMarkdown(fromArgs.content) ?? asMarkdown(storedData.content);

  return (
    <TimelineTrackDisplay
      name={name}
      color={color}
      parentLabel={parentLabel}
      position={position}
      description={description}
      contentMarkdown={contentMarkdown}
      mode={mode}
      changedFields={changedFields}
    />
  );
}

function renderEvent(params: RenderParams): React.ReactElement {
  const { operation, mode, lookup, language, values, changedFields, fallbackName } = params;
  const fromArgs = values ?? {};
  const stored = mode === 'read' || mode === 'delete' ? lookup.findEvent(operation.targetId) : undefined;
  const storedData = dataForLanguage(stored?.data, language);

  const trackId = (fromArgs.trackId as string | undefined) ?? stored?.trackId;
  const track = lookup.findTrack(trackId);

  const name =
    asString(fromArgs.name) ?? timelineName(stored?.data, language) ?? fallbackName ?? operation.targetLabel ?? 'Event';
  const startLabel = safeFormatDate(fromArgs.startDate ?? stored?.startDate, lookup.calendar);
  const endValue = 'endDate' in fromArgs ? fromArgs.endDate : stored?.endDate;
  const endLabel = safeFormatDate(endValue, lookup.calendar);
  const tags = 'tags' in fromArgs ? asTagList(fromArgs.tags) : stored?.tags ?? [];
  const linkCount = stored?.links?.length ?? 0;
  const description = asString(fromArgs.description) ?? asString(storedData.description);
  const contentMarkdown = asMarkdown(fromArgs.content) ?? asMarkdown(storedData.content);

  return (
    <TimelineEventDisplay
      name={name}
      trackColor={track?.color ?? null}
      trackLabel={track ? timelineName(track.data, language) ?? 'Track' : undefined}
      startLabel={startLabel}
      endLabel={endLabel}
      tags={tags}
      linkCount={linkCount}
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

/** Render one stored timeline event (read mode) from its store object. */
function renderEventNode(
  event: TimelineEvent,
  track: TimelineTrack | undefined,
  lookup: TimelineLookup,
  language: string,
): React.ReactElement {
  const data = dataForLanguage(event.data, language);
  return (
    <TimelineEventDisplay
      key={event.id}
      name={timelineName(event.data, language) ?? 'Event'}
      trackColor={track?.color ?? null}
      trackLabel={track ? timelineName(track.data, language) ?? 'Track' : undefined}
      startLabel={safeFormatDate(event.startDate, lookup.calendar)}
      endLabel={safeFormatDate(event.endDate, lookup.calendar)}
      tags={asTagList(event.tags)}
      linkCount={event.links?.length ?? 0}
      description={asString(data.description)}
      contentMarkdown={asMarkdown(data.content)}
      mode="read"
    />
  );
}

/** Recursively render a stored track (read mode) with its events and child tracks. */
function renderTrackNode(
  track: TimelineTrack,
  lookup: TimelineLookup,
  language: string,
): React.ReactElement {
  const data = dataForLanguage(track.data, language);
  const parentLabel = track.parentId
    ? timelineName(lookup.findTrack(track.parentId)?.data, language) ?? undefined
    : undefined;
  return (
    <div className="tl-tree__node" key={track.id}>
      <TimelineTrackDisplay
        name={timelineName(track.data, language) ?? 'Track'}
        color={track.color ?? null}
        parentLabel={parentLabel}
        position={track.position}
        description={asString(data.description)}
        contentMarkdown={asMarkdown(data.content)}
        mode="read"
      />
      {(track.events ?? []).map((event) => (
        <div className="tl-tree__leaf" key={event.id}>
          {renderEventNode(event, track, lookup, language)}
        </div>
      ))}
      {(track.children ?? []).map((child) => renderTrackNode(child, lookup, language))}
    </div>
  );
}

/** Render the whole timeline as a track/event tree (`read_timeline`). */
export function renderTimelineTree(lookup: TimelineLookup, language: string): React.ReactElement {
  if (!lookup.rootTracks.length) {
    return renderTimelineSummary(lookup);
  }
  return <div className="tl-tree">{lookup.rootTracks.map((track) => renderTrackNode(track, lookup, language))}</div>;
}

/** Render a single track plus its descendant subtree (`read_timeline_track`). */
export function renderTimelineTrackSubtree(params: {
  operation: ObjectOperationVM;
  lookup: TimelineLookup;
  language: string;
}): React.ReactElement {
  const { operation, lookup, language } = params;
  const root = lookup.findTrack(operation.targetId);
  if (!root) {
    // Store not loaded for this project / stale lookup: fall back to a single card.
    return renderTrack({ operation, mode: 'read', lookup, language });
  }
  return <div className="tl-tree">{renderTrackNode(root, lookup, language)}</div>;
}

/** Render a compact summary for a whole-timeline read (`read_timeline`). */
export function renderTimelineSummary(lookup: TimelineLookup): React.ReactElement {
  return (
    <div className="tl-link">
      <span className="tl-link__icon" aria-hidden>🗓</span>
      <span className="tl-link__event">Timeline</span>
      <span className="tl-link__target">
        {lookup.trackCount} track{lookup.trackCount === 1 ? '' : 's'} · {lookup.eventCount} event
        {lookup.eventCount === 1 ? '' : 's'}
      </span>
    </div>
  );
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
