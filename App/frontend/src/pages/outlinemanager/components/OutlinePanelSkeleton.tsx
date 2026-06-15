import React from 'react';
import { Skeleton } from '../../../components/common/Skeleton';

/** Loading skeleton mimicking the outline act-node / chapter-stream silhouette. */
const OutlinePanelSkeleton: React.FC = () => (
  <div
    aria-hidden="true"
    style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2xl)', padding: 'var(--spacing-xl)' }}
  >
    {[0, 1].map((actIndex) => (
      <div key={actIndex} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
        {/* Act node: marker + card */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)' }}>
          <Skeleton width={32} height={32} radius="var(--border-radius-full)" />
          <Skeleton height={64} radius="var(--border-radius-lg)" style={{ flex: 1 }} />
        </div>
        {/* Chapter stream */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--spacing-sm)',
            paddingLeft: 'var(--spacing-4xl)',
          }}
        >
          {[0, 1].map((chapterIndex) => (
            <div key={chapterIndex} style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)' }}>
              <Skeleton width={12} height={12} radius="var(--border-radius-full)" />
              <Skeleton
                height={48}
                radius="var(--border-radius-md)"
                style={{ flex: 1, maxWidth: `${80 - chapterIndex * 12}%` }}
              />
            </div>
          ))}
        </div>
      </div>
    ))}
  </div>
);

export default OutlinePanelSkeleton;
