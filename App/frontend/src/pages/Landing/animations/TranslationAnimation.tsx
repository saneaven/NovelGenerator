import React, { useEffect, useRef, useState } from 'react';
import { motion, useAnimate, AnimatePresence } from 'motion/react';
import './LandingAnimations.css';

interface TranslationAnimationProps {
  isActive: boolean;
}

const SPRING = { type: 'spring' as const, stiffness: 400, damping: 30 };

const JAPANESE_TEXT =
  '月明かりが古い図書館の窓から差し込み、埃っぽい本棚に長い影を落としていた。エレノアは静かに通路を歩きながら、指先で革の背表紙をなぞった。';

const ENGLISH_TEXT =
  'Moonlight streamed through the old library windows, casting long shadows across the dusty shelves. Eleanor walked quietly down the aisle, her fingertips tracing the leather spines as she passed.';

export const TranslationAnimation: React.FC<TranslationAnimationProps> = ({ isActive }) => {
  const [scope, animate] = useAnimate();
  const hasPlayed = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const [showTranslation, setShowTranslation] = useState(false);
  const [showBadge, setShowBadge] = useState(false);

  useEffect(() => {
    if (!isActive) {
      hasPlayed.current = false;
      abortRef.current?.abort();
      abortRef.current = null;
      setShowTranslation(false);
      setShowBadge(false);
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
        // 1. Japanese bubble slides in
        await animate(
          '[data-anim="ja-bubble"]',
          { opacity: 1, y: 0 },
          { duration: 0.4, ...SPRING, signal: controller.signal }
        );

        // 2. Action bar fades in
        await animate(
          '[data-anim="action-bar"]',
          { opacity: 1 },
          { duration: 0.3, signal: controller.signal }
        );

        // 3. Globe button pulses (simulated click)
        await delay(400);
        await animate(
          '[data-anim="globe-btn"]',
          { scale: 0.92 },
          { duration: 0.1, signal: controller.signal }
        );
        await animate(
          '[data-anim="globe-btn"]',
          { scale: 1 },
          { duration: 0.15, ...SPRING, signal: controller.signal }
        );

        // 4. Typing indicator
        await animate(
          '[data-anim="typing"]',
          { opacity: 1 },
          { duration: 0.2, signal: controller.signal }
        );
        await delay(600);
        await animate(
          '[data-anim="typing"]',
          { opacity: 0 },
          { duration: 0.15, signal: controller.signal }
        );

        // 5. Translation appears
        setShowTranslation(true);
        await delay(400);

        // 6. Language badge
        setShowBadge(true);
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
      {/* Japanese text bubble */}
      <motion.div
        data-anim="ja-bubble"
        className="landing-anim-bubble landing-anim-bubble--assistant"
        initial={{ opacity: 0, y: 12 }}
      >
        <div className="landing-anim-prose" lang="ja">
          {JAPANESE_TEXT}
        </div>
      </motion.div>

      {/* Action bar */}
      <motion.div
        data-anim="action-bar"
        className="landing-anim-action-bar"
        initial={{ opacity: 0 }}
      >
        <motion.button
          data-anim="globe-btn"
          className="landing-anim-action-btn"
          type="button"
          tabIndex={-1}
          initial={{ scale: 1 }}
        >
          🌐 Translate to English
        </motion.button>
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

      {/* Translation result */}
      <AnimatePresence>
        {showTranslation && (
          <motion.div
            className="landing-anim-bubble landing-anim-bubble--assistant"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ...SPRING }}
          >
            <div className="landing-anim-prose">
              {ENGLISH_TEXT}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Language badge */}
      <AnimatePresence>
        {showBadge && (
          <motion.div
            className="landing-anim-lang-badge"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2, ...SPRING }}
          >
            JA → EN
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
