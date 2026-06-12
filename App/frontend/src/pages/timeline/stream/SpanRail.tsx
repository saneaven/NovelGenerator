import React from 'react';
import type { SpanGeometryItem } from '../hooks/useSpanGeometry';
import { trackColorProps } from '../timelineColors';

interface SpanRailProps {
  geometries: SpanGeometryItem[];
  /** dimmed while a card expand/collapse animation runs */
  dimmed: boolean;
  onJumpToEvent: (eventId: string) => void;
}

/**
 * Absolutely-positioned duration rails in the gutter beside the spine.
 * Geometry comes from measured row positions (useSpanGeometry); segments
 * crossing a break separator render dashed.
 */
const SpanRail: React.FC<SpanRailProps> = ({ geometries, dimmed, onJumpToEvent }) => {
  if (geometries.length === 0) return null;

  // rendered inside the rows <ol>: an absolutely-positioned <li> stays valid HTML
  return (
    <li className={`tl-rail-overlay ${dimmed ? 'tl-rail-overlay--dimmed' : ''}`} aria-hidden="true">
      {geometries.map((geo) => {
        const height = Math.max(geo.bottomPx - geo.topPx, 4);
        // solid sub-segments between dashed break segments
        const cuts = geo.breakSegments
          .map((seg) => ({
            top: Math.max(seg.topPx, geo.topPx),
            bottom: Math.min(seg.bottomPx, geo.bottomPx),
          }))
          .filter((seg) => seg.bottom > seg.top)
          .sort((a, b) => a.top - b.top);

        const solids: Array<{ top: number; bottom: number }> = [];
        let cursor = geo.topPx;
        for (const cut of cuts) {
          if (cut.top > cursor) solids.push({ top: cursor, bottom: cut.top });
          cursor = Math.max(cursor, cut.bottom);
        }
        if (cursor < geo.bottomPx) solids.push({ top: cursor, bottom: geo.bottomPx });

        const colorProps = trackColorProps(geo.colorKey);

        return (
          <div
            key={geo.eventId}
            className={`tl-rail ${colorProps.className}`}
            style={{ ...colorProps.style, top: geo.topPx, height, left: 18 + geo.lane * 14 }}
          >
            <button
              type="button"
              className="tl-rail__hit"
              title={geo.name}
              tabIndex={-1}
              onClick={() => onJumpToEvent(geo.eventId)}
            />
            {solids.map((seg) => (
              <span
                key={`${seg.top}`}
                className="tl-rail__solid"
                style={{ top: seg.top - geo.topPx, height: seg.bottom - seg.top }}
              />
            ))}
            {cuts.map((seg) => (
              <span
                key={`d${seg.top}`}
                className="tl-rail__dashed"
                style={{ top: seg.top - geo.topPx, height: seg.bottom - seg.top }}
              />
            ))}
            <span className="tl-rail__cap tl-rail__cap--start" />
            <span className="tl-rail__cap tl-rail__cap--end" />
          </div>
        );
      })}
    </li>
  );
};

export default React.memo(SpanRail);
