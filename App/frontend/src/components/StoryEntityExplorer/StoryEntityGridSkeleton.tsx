import React from 'react';
import { Skeleton } from '../common/Skeleton';

/** Loading skeleton mimicking the story-entity card grid. */
const StoryEntityGridSkeleton: React.FC<{ count?: number }> = ({ count = 6 }) => (
  <div className="object-cards-grid story-entity-cards-grid" aria-hidden="true">
    {Array.from({ length: count }).map((_, index) => (
      <div key={index} style={{ height: '100%', minHeight: '33dvh' }}>
        <Skeleton height="100%" radius="var(--border-radius-lg)" />
      </div>
    ))}
  </div>
);

export default StoryEntityGridSkeleton;
