import React, { useEffect, useRef } from 'react';
import { motion, useAnimate } from 'motion/react';
import './LandingAnimations.css';

interface AgentWritingAnimationProps {
  isActive: boolean;
}

const SPRING = { type: 'spring' as const, stiffness: 400, damping: 30 };

const PROSE_LINES = [
  'Eleanor traced her fingers along the cracked spine of the manuscript,',
  'its leather cover warm beneath her touch as if the words inside still',
  'breathed with a life of their own. The Archive had kept this secret',
  'for three hundred years — and now it trembled in her hands.',
];

const CONTEXT_CHIPS = ['Eleanor Voss', 'The Archive', 'Chapter 3'];

export const AgentWritingAnimation: React.FC<AgentWritingAnimationProps> = ({ isActive }) => {
  const [scope, animate] = useAnimate();
  const hasPlayed = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!isActive) {
      hasPlayed.current = false;
      abortRef.current?.abort();
      abortRef.current = null;
      return;
    }

    if (hasPlayed.current) return;
    hasPlayed.current = true;

    const controller = new AbortController();
    abortRef.current = controller;

    const run = async () => {
      try {
        // 1. Context chips stagger in
        for (let i = 0; i < CONTEXT_CHIPS.length; i++) {
          await animate(
            `[data-anim="chip-${i}"]`,
            { opacity: 1, y: 0 },
            { duration: 0.25, ...SPRING, signal: controller.signal }
          );
        }

        // 2. User bubble slides in
        await animate(
          '[data-anim="user-bubble"]',
          { opacity: 1, x: 0 },
          { duration: 0.4, ...SPRING, signal: controller.signal }
        );

        // 3. Typing indicator
        await animate(
          '[data-anim="typing"]',
          { opacity: 1 },
          { duration: 0.2, signal: controller.signal }
        );
        await animate(
          '[data-anim="typing"]',
          { opacity: 1 },
          { duration: 0.7, signal: controller.signal }
        );
        await animate(
          '[data-anim="typing"]',
          { opacity: 0 },
          { duration: 0.15, signal: controller.signal }
        );

        // 4. Assistant bubble appears
        await animate(
          '[data-anim="assistant-bubble"]',
          { opacity: 1, y: 0 },
          { duration: 0.3, ...SPRING, signal: controller.signal }
        );

        // 5. Prose lines reveal one by one
        for (let i = 0; i < PROSE_LINES.length; i++) {
          await animate(
            `[data-anim="prose-${i}"]`,
            { opacity: 1, y: 0 },
            { duration: 0.35, delay: 0.1, signal: controller.signal }
          );
        }
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
      {/* Context chips */}
      <div className="landing-anim-chips">
        {CONTEXT_CHIPS.map((chip, i) => (
          <motion.span
            key={chip}
            data-anim={`chip-${i}`}
            className="landing-anim-chip"
            initial={{ opacity: 0, y: -8 }}
          >
            {chip}
          </motion.span>
        ))}
      </div>

      {/* User message */}
      <motion.div
        data-anim="user-bubble"
        className="landing-anim-bubble landing-anim-bubble--user"
        initial={{ opacity: 0, x: 20 }}
      >
        Write the scene where Eleanor discovers the hidden manuscript
      </motion.div>

      {/* Typing indicator */}
      <motion.div
        data-anim="typing"
        className="landing-anim-typing"
        initial={{ opacity: 0 }}
      >
        <div className="landing-anim-typing-track">
          <div className="landing-anim-typing-bar" />
        </div>
      </motion.div>

      {/* Assistant bubble with prose */}
      <motion.div
        data-anim="assistant-bubble"
        className="landing-anim-bubble landing-anim-bubble--assistant"
        initial={{ opacity: 0, y: 12 }}
      >
        <div className="landing-anim-prose">
          {PROSE_LINES.map((line, i) => (
            <motion.span
              key={i}
              data-anim={`prose-${i}`}
              style={{ display: 'inline' }}
              initial={{ opacity: 0, y: 6 }}
            >
              {line}{' '}
            </motion.span>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
};
