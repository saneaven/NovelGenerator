import React, { useEffect, useRef, useState } from 'react';
import { IconButton } from '../IconButton';
import { Info } from '../icons';
import './StorageUsageSummary.css';

export interface StorageUsageBreakdownDetail {
  id: string;
  label: string;
  value: string;
}

export interface StorageUsageBreakdownItem {
  id: string;
  name: string;
  meta: string;
  details?: StorageUsageBreakdownDetail[];
  detailToggleLabel?: string;
}

export interface StorageUsageSummaryLabels {
  used: string;
  remaining: string;
  quota: string;
  breakdownTitle?: string;
}

export interface StorageUsageSummaryProps {
  usedBytes: number;
  remainingBytes: number;
  quotaBytes: number;
  percentUsed: number;
  labels: StorageUsageSummaryLabels;
  breakdownItems?: StorageUsageBreakdownItem[];
  compact?: boolean;
  className?: string;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const precision = unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

const StorageUsageSummary: React.FC<StorageUsageSummaryProps> = ({
  usedBytes,
  remainingBytes,
  quotaBytes,
  percentUsed,
  labels,
  breakdownItems = [],
  compact = false,
  className = '',
}) => {
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const anchorRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const classes = [
    'storage-usage-summary',
    compact && 'storage-usage-summary--compact',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const normalizedPercent = Math.round(Math.min(Math.max(percentUsed ?? 0, 0), 1) * 100);
  const toggleBreakdownItem = (itemId: string) => {
    setOpenItemId((current) => (current === itemId ? null : itemId));
  };

  useEffect(() => {
    if (!openItemId) return undefined;

    const handlePointerDown = (event: MouseEvent) => {
      const activeAnchor = anchorRefs.current[openItemId];
      if (!activeAnchor) {
        setOpenItemId(null);
        return;
      }

      if (!activeAnchor.contains(event.target as Node)) {
        setOpenItemId(null);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [openItemId]);

  return (
    <div className={classes}>
      <div className="storage-usage-summary__metrics">
        <div className="storage-usage-summary__metric">
          <div className="storage-usage-summary__label">{labels.used}</div>
          <div className="storage-usage-summary__value">{formatBytes(usedBytes)}</div>
        </div>
        <div className="storage-usage-summary__metric">
          <div className="storage-usage-summary__label">{labels.remaining}</div>
          <div className="storage-usage-summary__value">{formatBytes(remainingBytes)}</div>
        </div>
        <div className="storage-usage-summary__metric">
          <div className="storage-usage-summary__label">{labels.quota}</div>
          <div className="storage-usage-summary__value">{formatBytes(quotaBytes)}</div>
        </div>
      </div>

      <div className="storage-usage-summary__bar" aria-label="storage usage">
        <div className="storage-usage-summary__fill" style={{ width: `${normalizedPercent}%` }} />
      </div>

      {breakdownItems.length > 0 && labels.breakdownTitle && (
        <div className="storage-usage-summary__breakdown">
          <div className="storage-usage-summary__breakdown-title">{labels.breakdownTitle}</div>
          <div className="storage-usage-summary__breakdown-list">
            {breakdownItems.map((item) => {
              const hasDetails = (item.details?.length ?? 0) > 0;
              const isExpanded = hasDetails && openItemId === item.id;

              return (
                <div key={item.id} className="storage-usage-summary__breakdown-item">
                  <div className="storage-usage-summary__breakdown-name">{item.name}</div>
                  <div className="storage-usage-summary__breakdown-trailing">
                    <div className="storage-usage-summary__breakdown-meta">{item.meta}</div>
                    {hasDetails && (
                      <div
                        className="storage-usage-summary__dropdown-anchor"
                        ref={(node) => {
                          anchorRefs.current[item.id] = node;
                        }}
                      >
                        <IconButton
                          icon={<Info size="sm" />}
                          size="xs"
                          variant="ghost"
                          className="storage-usage-summary__detail-toggle"
                          title={item.detailToggleLabel}
                          ariaLabel={item.detailToggleLabel}
                          ariaExpanded={isExpanded}
                          isActive={isExpanded}
                          onClick={() => toggleBreakdownItem(item.id)}
                        />

                        {isExpanded && (
                          <div className="storage-usage-summary__detail-dropdown">
                            {item.details?.map((detail) => (
                              <div key={`${item.id}-${detail.id}`} className="storage-usage-summary__detail-row">
                                <span className="storage-usage-summary__detail-label">{detail.label}</span>
                                <span className="storage-usage-summary__detail-value">{detail.value}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default StorageUsageSummary;
