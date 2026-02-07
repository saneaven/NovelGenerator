import React, { useEffect, useRef, useState } from 'react';
import { motion, useAnimate, AnimatePresence } from 'motion/react';
import './LandingAnimations.css';

interface AgentQueryAnimationProps {
  isActive: boolean;
}

const SPRING = { type: 'spring' as const, stiffness: 400, damping: 30 };

const SEARCH_ITEMS = [
  { icon: '👤', label: 'Eleanor Voss — Character Profile' },
  { icon: '⚔️', label: 'Council Confrontation — Event' },
  { icon: '📝', label: 'Chapter 2: The Tribunal — Scene' },
];

const REFERENCE_CHIPS = ['Ch.2', 'Eleanor', 'Council'];

export const AgentQueryAnimation: React.FC<AgentQueryAnimationProps> = ({ isActive }) => {
  const [scope, animate] = useAnimate();
  const hasPlayed = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);

  useEffect(() => {
    if (!isActive) {
      hasPlayed.current = false;
      abortRef.current?.abort();
      abortRef.current = null;
      setShowSearch(false);
      setHighlightIndex(-1);
      return;
    }

    if (hasPlayed.current) return;
    hasPlayed.current = true;

    const controller = new AbortController();
    abortRef.current = controller;

    const delay = (ms: number) =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        controller.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });

    const run = async () => {
      try {
        // 1. User bubble slides in
        await animate(
          '[data-anim="user-bubble"]',
          { opacity: 1, x: 0 },
          { duration: 0.4, ...SPRING, signal: controller.signal }
        );

        // 2. Show search panel
        setShowSearch(true);
        await delay(300);

        // 3. Highlight items one by one (scanning effect)
        for (let i = 0; i < SEARCH_ITEMS.length; i++) {
          setHighlightIndex(i);
          await delay(400);
        }
        setHighlightIndex(-1);
        await delay(200);

        // 4. Hide search panel
        setShowSearch(false);
        await delay(300);

        // 5. Reference chips slide in
        for (let i = 0; i < REFERENCE_CHIPS.length; i++) {
          await animate(
            `[data-anim="ref-${i}"]`,
            { opacity: 1, x: 0 },
            { duration: 0.2, ...SPRING, signal: controller.signal }
          );
        }

        // 6. Assistant bubble appears
        await animate(
          '[data-anim="assistant-bubble"]',
          { opacity: 1, y: 0 },
          { duration: 0.3, ...SPRING, signal: controller.signal }
        );
      } catch {
        // Animation aborted
      }
    };

    run();

    return () => {
      controller.abort();
    };
  }, [isActive, animate]);

  return (
    <motion.div
      ref={scope}
      className="landing-anim-frame"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={isActive ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.4 }}
    >
      {/* User message */}
      <motion.div
        data-anim="user-bubble"
        className="landing-anim-bubble landing-anim-bubble--user"
        initial={{ opacity: 0, x: 20 }}
      >
        What conflicts exist between Eleanor and the Council?
      </motion.div>

      {/* Search panel */}
      <AnimatePresence>
        {showSearch && (
          <motion.div
            className="landing-anim-search"
            initial={{ opacity: 0, y: 8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: -4, height: 0 }}
            transition={{ duration: 0.25 }}
          >
            <div className="landing-anim-search-header">
              🔍 Searching story database...
            </div>
            {SEARCH_ITEMS.map((item, i) => (
              <div
                key={i}
                className={`landing-anim-search-item${i === highlightIndex ? ' landing-anim-search-item--highlight' : ''}`}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reference chips */}
      <div className="landing-anim-chips">
        {REFERENCE_CHIPS.map((chip, i) => (
          <motion.span
            key={chip}
            data-anim={`ref-${i}`}
            className="landing-anim-ref-badge"
            initial={{ opacity: 0, x: -8 }}
          >
            {chip}
          </motion.span>
        ))}
      </div>

      {/* Assistant bubble */}
      <motion.div
        data-anim="assistant-bubble"
        className="landing-anim-bubble landing-anim-bubble--assistant"
        initial={{ opacity: 0, y: 12 }}
      >
        Eleanor's primary conflict with the Council stems from her refusal to surrender the Archive's forbidden texts.
        In <span className="landing-anim-ref-badge">Ch.2</span>, the Tribunal demanded she relinquish access, but she
        invoked the Keeper's Oath — an ancient clause the <span className="landing-anim-ref-badge">Council</span> had
        long forgotten.
      </motion.div>
    </motion.div>
  );
};
