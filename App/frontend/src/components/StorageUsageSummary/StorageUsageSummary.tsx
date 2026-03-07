import React from 'react';
import './StorageUsageSummary.css';

export interface StorageUsageBreakdownItem {
  id: string;
  name: string;
  meta: string;
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
  const classes = [
    'storage-usage-summary',
    compact && 'storage-usage-summary--compact',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const normalizedPercent = Math.round(Math.min(Math.max(percentUsed ?? 0, 0), 1) * 100);

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
            {breakdownItems.map((item) => (
              <div key={item.id} className="storage-usage-summary__breakdown-item">
                <div className="storage-usage-summary__breakdown-name">{item.name}</div>
                <div className="storage-usage-summary__breakdown-meta">{item.meta}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default StorageUsageSummary;
