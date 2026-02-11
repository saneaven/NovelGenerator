import React from 'react';
import { AnimatePresence, motion } from 'motion/react';

export interface FunctionCallContentIslandProps {
  panelId: string;
  expanded: boolean;
  children: React.ReactNode;
}

export const FunctionCallContentIsland: React.FC<FunctionCallContentIslandProps> = ({
  panelId,
  expanded,
  children,
}) => {
  return (
    <AnimatePresence initial={false}>
      {expanded && (
        <motion.div
          id={panelId}
          className="function-call-content-island"
          role="region"
          initial={{ height: 0, opacity: 0, y: -4 }}
          animate={{ height: 'auto', opacity: 1, y: 0 }}
          exit={{ height: 0, opacity: 0, y: -4 }}
          transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <div className="function-call-content-island__inner">{children}</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default FunctionCallContentIsland;
