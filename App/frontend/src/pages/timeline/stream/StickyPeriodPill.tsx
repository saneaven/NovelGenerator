import React from 'react';
import { AnimatePresence, motion } from 'motion/react';

interface StickyPeriodPillProps {
  label: string | null;
}

/** Sticky top-unit orientation pill — the zoomless answer to "when am I?". */
const StickyPeriodPill: React.FC<StickyPeriodPillProps> = ({ label }) => (
  <div className="tl-period-pill-slot" aria-hidden="true">
    <AnimatePresence mode="popLayout" initial={false}>
      {label && (
        <motion.span
          key={label}
          className="tl-period-pill"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.15 }}
        >
          {label}
        </motion.span>
      )}
    </AnimatePresence>
  </div>
);

export default React.memo(StickyPeriodPill);
