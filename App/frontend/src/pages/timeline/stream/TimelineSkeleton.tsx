import React from 'react';

/** Loading shimmer mimicking the stream silhouette. */
const TimelineSkeleton: React.FC = () => (
  <div className="tl-skeleton" aria-hidden="true">
    {[0, 1, 2, 3].map((i) => (
      <div className="tl-skeleton__row" key={i} style={{ marginTop: i === 0 ? 0 : 56 + (i % 3) * 32 }}>
        <span className="tl-skeleton__gutter" />
        <span className="tl-skeleton__node" />
        <span className="tl-skeleton__card" style={{ width: `${72 - (i % 3) * 14}%` }} />
      </div>
    ))}
  </div>
);

export default TimelineSkeleton;
