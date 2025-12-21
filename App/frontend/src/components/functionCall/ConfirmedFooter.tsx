import React from 'react';

interface ConfirmedFooterProps {
  appliedCount: number;
  rejectedCount: number;
}

export const ConfirmedFooter: React.FC<ConfirmedFooterProps> = ({
  appliedCount,
  rejectedCount,
}) => {
  return (
    <div className="fc-footer fc-footer--confirmed">
      <div className="fc-footer__summary-confirmed">
        {appliedCount > 0 && (
          <span className="fc-footer__applied">{appliedCount} applied</span>
        )}
        {rejectedCount > 0 && (
          <span className="fc-footer__skipped">{rejectedCount} skipped</span>
        )}
      </div>
    </div>
  );
};
