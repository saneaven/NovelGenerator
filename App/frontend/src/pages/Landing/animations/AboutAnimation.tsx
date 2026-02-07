import React, { useEffect, useRef } from 'react';
import { motion, useAnimate, AnimatePresence } from 'motion/react';
import './LandingAnimations.css';

interface AboutAnimationProps {
  isActive: boolean;
}

const SPRING = { type: 'spring' as const, stiffness: 400, damping: 30 };

export const AboutAnimation: React.FC<AboutAnimationProps> = ({ isActive }) => {
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
        // 1. User bubble slides in
        await animate(
          '[data-anim="user-bubble"]',
          { opacity: 1, x: 0 },
          { duration: 0.4, ...SPRING, signal: controller.signal }
        );

        // 2. Typing indicator appears
        await animate(
          '[data-anim="typing"]',
          { opacity: 1 },
          { duration: 0.2, signal: controller.signal }
        );

        // Wait while typing
        await animate(
          '[data-anim="typing"]',
          { opacity: 1 },
          { duration: 0.8, signal: controller.signal }
        );

        // 3. Typing fades out
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

        // 5. Character card elements stagger in
        await animate(
          '[data-anim="char-avatar"]',
          { opacity: 1, scale: 1 },
          { duration: 0.3, ...SPRING, signal: controller.signal }
        );
        await animate(
          '[data-anim="char-name"]',
          { opacity: 1, y: 0 },
          { duration: 0.2, signal: controller.signal }
        );
        await animate(
          '[data-anim="char-role"]',
          { opacity: 1, y: 0 },
          { duration: 0.2, signal: controller.signal }
        );
        await animate(
          '[data-anim="char-desc"]',
          { opacity: 1, y: 0 },
          { duration: 0.2, signal: controller.signal }
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
        Create a character: A mysterious librarian who guards ancient secrets
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

      {/* Assistant bubble with character card */}
      <motion.div
        data-anim="assistant-bubble"
        className="landing-anim-bubble landing-anim-bubble--assistant"
        initial={{ opacity: 0, y: 12 }}
      >
        <div className="landing-anim-char-card">
          <motion.div
            data-anim="char-avatar"
            className="landing-anim-avatar"
            initial={{ opacity: 0, scale: 0 }}
          >
            EV
          </motion.div>
          <div className="landing-anim-char-info">
            <motion.div
              data-anim="char-name"
              className="landing-anim-char-name"
              initial={{ opacity: 0, y: 8 }}
            >
              Eleanor Voss
            </motion.div>
            <motion.div
              data-anim="char-role"
              className="landing-anim-char-role"
              initial={{ opacity: 0, y: 8 }}
            >
              Librarian / Secret Keeper
            </motion.div>
            <motion.div
              data-anim="char-desc"
              className="landing-anim-char-desc"
              initial={{ opacity: 0, y: 8 }}
            >
              A reclusive scholar who has dedicated her life to protecting forbidden knowledge hidden within the Archive's deepest vaults.
            </motion.div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};
