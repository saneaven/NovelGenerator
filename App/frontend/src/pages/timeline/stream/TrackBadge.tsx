import React from 'react';
import type { TrackPathEntry } from '../layout/types';
import { trackColorProps } from '../timelineColors';

interface TrackBadgeProps {
  trackPath: TrackPathEntry[];
  colorKey: string | null;
}

/**
 * Effective-color dot + condensed track path. Depth >= 3 keeps the immediate
 * parent visible (`… › Parent › Leaf`); the full path lives in the title.
 */
const TrackBadge: React.FC<TrackBadgeProps> = ({ trackPath, colorKey }) => {
  const names = trackPath.map((entry) => entry.name || '—');
  const fullPath = names.join(' › ');
  const condensed = names.length <= 2
    ? fullPath
    : `… › ${names[names.length - 2]} › ${names[names.length - 1]}`;

  const colorProps = trackColorProps(colorKey);

  return (
    <span className={`tl-badge ${colorProps.className}`} style={colorProps.style} title={fullPath}>
      <span className="tl-badge__dot" aria-hidden="true" />
      <span className="tl-badge__path">{condensed}</span>
    </span>
  );
};

export default React.memo(TrackBadge);
