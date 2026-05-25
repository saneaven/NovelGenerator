import React, { useMemo } from 'react';
import { useSettingsStore } from '../../../store/settingsStore';
import { getTrackColors } from '../../../pages/timeline/timelineColors';
import type { ObjectOperationVM } from '../vmTypes';
import { PatchGroupCard } from './PatchGroupCard';
import type { PatchGroupCardProps, PatchMetaChange } from './types';
import { asTagList, safeFormatDate, timelineName, useTimelineLookup, type TimelineLookup } from './timelineCardData';

type TimelinePatchGroupCardProps = Omit<PatchGroupCardProps, 'accentColor' | 'metaChanges'> & {
  objectType: 'timeline_track' | 'timeline_event';
};

function trackMetaChanges(args: Record<string, unknown>, lookup: TimelineLookup, language: string): PatchMetaChange[] {
  const changes: PatchMetaChange[] = [];
  if (typeof args.color === 'string') changes.push({ label: 'color', value: args.color });
  if (typeof args.position === 'number') changes.push({ label: 'position', value: String(args.position) });
  if ('parentId' in args) {
    const parentId = typeof args.parentId === 'string' ? args.parentId : null;
    const parentLabel = parentId ? timelineName(lookup.findTrack(parentId)?.data, language) ?? parentId : 'root';
    changes.push({ label: 'parent', value: parentLabel });
  }
  return changes;
}

function eventMetaChanges(args: Record<string, unknown>, lookup: TimelineLookup, language: string): PatchMetaChange[] {
  const changes: PatchMetaChange[] = [];
  if (typeof args.trackId === 'string') {
    const trackLabel = timelineName(lookup.findTrack(args.trackId)?.data, language) ?? args.trackId;
    changes.push({ label: 'track', value: trackLabel });
  }
  if ('startDate' in args) {
    changes.push({ label: 'start', value: safeFormatDate(args.startDate, lookup.calendar) ?? '—' });
  }
  if ('endDate' in args) {
    changes.push({ label: 'end', value: safeFormatDate(args.endDate, lookup.calendar) ?? 'none' });
  }
  if ('tags' in args) {
    const tags = asTagList(args.tags);
    changes.push({ label: 'tags', value: tags.length > 0 ? tags.join(', ') : 'none' });
  }
  return changes;
}

/** PatchGroupCard wrapper that injects timeline track color + metadata-change chips. */
export const TimelinePatchGroupCard: React.FC<TimelinePatchGroupCardProps> = ({ objectType, ...props }) => {
  const language = useSettingsStore((state) => state.getSettings().mainLanguage);
  const lookup = useTimelineLookup(props.projectId);

  const { accentColor, metaChanges } = useMemo(() => {
    const first = props.operations[0] as ObjectOperationVM | undefined;
    const targetId = first?.targetId ?? (typeof first?.args.id === 'string' ? first.args.id : undefined);

    const track = objectType === 'timeline_track'
      ? lookup.findTrack(targetId)
      : lookup.findTrack(lookup.findEvent(targetId)?.trackId);
    const color = track?.color ?? null;

    const meta: PatchMetaChange[] = [];
    for (const operation of props.operations) {
      const args = operation.args;
      meta.push(...(objectType === 'timeline_track'
        ? trackMetaChanges(args, lookup, language)
        : eventMetaChanges(args, lookup, language)));
    }

    return { accentColor: color ? getTrackColors(color).labelBar : undefined, metaChanges: meta };
  }, [props.operations, objectType, lookup, language]);

  return <PatchGroupCard {...props} accentColor={accentColor} metaChanges={metaChanges} />;
};

export default TimelinePatchGroupCard;
