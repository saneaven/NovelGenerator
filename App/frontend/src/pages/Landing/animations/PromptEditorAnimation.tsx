import React, { useEffect, useRef, useState } from 'react';
import { motion, useAnimate, AnimatePresence } from 'motion/react';
import './LandingAnimations.css';

interface PromptEditorAnimationProps {
  isActive: boolean;
}

const SPRING = { type: 'spring' as const, stiffness: 400, damping: 30 };

const PROMPT_A = 'Write in the style of a Victorian gothic novelist. Use elaborate prose, atmospheric descriptions, and a sense of dark mystery.';
const PROMPT_B = 'Write in the style of a modern thriller author. Use punchy sentences, sharp dialogue, and relentless pacing.';

const PROSE_A =
  'The mansion loomed before her like a great beast crouching in the mist, its darkened windows staring out like hollow eyes that had witnessed centuries of unspeakable secrets whispered within its crumbling walls.';
const PROSE_B =
  'The mansion was wrong. She knew it the second she stepped out of the car. Too quiet. Too still. The kind of place where people disappeared and nobody asked questions.';

type Phase = 'initial' | 'promptA' | 'proseA' | 'transition' | 'promptB' | 'proseB';

export const PromptEditorAnimation: React.FC<PromptEditorAnimationProps> = ({ isActive }) => {
  const [scope, animate] = useAnimate();
  const hasPlayed = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const [phase, setPhase] = useState<Phase>('initial');

  useEffect(() => {
    if (!isActive) {
      hasPlayed.current = false;
      abortRef.current?.abort();
      abortRef.current = null;
      setPhase('initial');
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
        // 1. Prompt editor card slides in
        await animate(
          '[data-anim="editor"]',
          { opacity: 1, y: 0 },
          { duration: 0.4, ...SPRING, signal: controller.signal }
        );

        setPhase('promptA');
        await delay(400);

        // 2. User bubble slides in
        await animate(
          '[data-anim="user-bubble"]',
          { opacity: 1, x: 0 },
          { duration: 0.3, ...SPRING, signal: controller.signal }
        );

        // 3. Typing indicator
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

        // 4. Victorian prose appears
        setPhase('proseA');
        await delay(1800);

        // 5. Transition: prompt changes
        setPhase('transition');
        await delay(400);
        setPhase('promptB');
        await delay(400);

        // 6. Prose crossfades to thriller
        setPhase('proseB');
      } catch {
        // Animation aborted
      }
    };

    run();

    return () => {
      controller.abort();
    };
  }, [isActive, animate]);

  const currentPrompt = phase === 'promptB' || phase === 'proseB' ? PROMPT_B : PROMPT_A;
  const showPrompt = phase !== 'initial' && phase !== 'transition';

  const showProseA = phase === 'proseA';
  const showProseB = phase === 'proseB';

  const isSecondary = phase === 'promptB' || phase === 'proseB';

  return (
    <motion.div
      ref={scope}
      className="landing-anim-frame"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={isActive ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.4 }}
    >
      {/* Prompt editor card */}
      <motion.div
        data-anim="editor"
        className="landing-anim-editor"
        initial={{ opacity: 0, y: -12 }}
      >
        <AnimatePresence mode="wait">
          {showPrompt && (
            <motion.div
              key={currentPrompt}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              {currentPrompt}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* User message */}
      <motion.div
        data-anim="user-bubble"
        className="landing-anim-bubble landing-anim-bubble--user"
        initial={{ opacity: 0, x: 20 }}
      >
        Describe the mansion
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

      {/* Prose output with color-changing accent */}
      <div
        className="landing-anim-bubble landing-anim-bubble--assistant"
        style={{
          borderLeftColor: isSecondary
            ? 'var(--color-secondary-main)'
            : 'var(--color-primary-main)',
          transition: 'border-left-color 0.5s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--spacing-sm)' }}>
          {/* Avatar with color shift */}
          <motion.div
            className="landing-anim-avatar"
            animate={{
              background: isSecondary
                ? 'var(--gradient-secondary)'
                : 'var(--gradient-primary)',
            }}
            transition={{ duration: 0.5 }}
            style={{ background: 'var(--gradient-primary)' }}
          >
            AI
          </motion.div>

          <div className="landing-anim-prose" style={{ flex: 1 }}>
            <AnimatePresence mode="wait">
              {showProseA && (
                <motion.div
                  key="proseA"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.3 }}
                >
                  {PROSE_A}
                </motion.div>
              )}
              {showProseB && (
                <motion.div
                  key="proseB"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.3 }}
                >
                  {PROSE_B}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </motion.div>
  );
};
