import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { TypingText } from './TypingText';
import './LandingAnimations.css';

interface PromptEditorAnimationProps {
  isActive: boolean;
}

const SPRING = { type: 'spring' as const, stiffness: 400, damping: 30 };

const PROMPT_A =
  'Write in the style of a Victorian gothic novelist. Use elaborate prose, atmospheric descriptions, and a sense of dark mystery.';
const PROMPT_B =
  'Write in the style of a modern thriller author. Use punchy sentences, sharp dialogue, and relentless pacing.';

const USER_MSG = 'Describe the mansion';

const PROSE_A =
  'The mansion loomed before her like a great beast crouching in the mist, its darkened windows staring out like hollow eyes that had witnessed centuries of unspeakable secrets whispered within its crumbling walls.';
const PROSE_B =
  'The mansion was wrong. She knew it the second she stepped out of the car. Too quiet. Too still. The kind of place where people disappeared and nobody asked questions.';

type Phase =
  | 'promptA'
  | 'userTyping'
  | 'thinking'
  | 'proseA'
  | 'pauseA'
  | 'promptB'
  | 'proseB'
  | 'done';

const PromptEditorContent: React.FC = () => {
  const [phase, setPhase] = useState<Phase>('promptA');

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    switch (phase) {
      case 'thinking':
        t = setTimeout(() => setPhase('proseA'), 800);
        break;
      case 'pauseA':
        t = setTimeout(() => setPhase('promptB'), 1200);
        break;
      default:
        return;
    }
    return () => clearTimeout(t);
  }, [phase]);

  const showUser = phase !== 'promptA';
  const showTyping = phase === 'thinking';
  const isSecondary =
    phase === 'promptB' || phase === 'proseB' || phase === 'done';
  const showProseA = phase === 'proseA' || phase === 'pauseA';
  const showProseB = phase === 'proseB' || phase === 'done';
  const showProse = showProseA || showProseB;

  const currentPrompt = isSecondary ? PROMPT_B : PROMPT_A;

  return (
    <>
      {/* Prompt editor card */}
      <motion.div
        className="landing-anim-editor"
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ...SPRING }}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={currentPrompt}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            onAnimationComplete={() => {
              if (phase === 'promptA') setPhase('userTyping');
              if (phase === 'promptB') setPhase('proseB');
            }}
          >
            {currentPrompt}
          </motion.div>
        </AnimatePresence>
      </motion.div>

      {/* User message */}
      {showUser && (
        <motion.div
          className="landing-anim-bubble landing-anim-bubble--user"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3, ...SPRING }}
        >
          <TypingText
            text={USER_MSG}
            active
            speed={30}
            onComplete={() => setPhase('thinking')}
          />
        </motion.div>
      )}

      {/* Typing indicator */}
      <motion.div
        className="landing-anim-typing"
        animate={{ opacity: showTyping ? 1 : 0 }}
        transition={{ duration: 0.15 }}
      >
        <div className="landing-anim-typing-track">
          <div className="landing-anim-typing-bar" />
        </div>
      </motion.div>

      {/* Prose output with color-changing avatar */}
      {showProse && (
        <div className="landing-anim-bubble landing-anim-bubble--assistant">
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--spacing-sm)' }}>
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
                    transition={{ duration: 0.4 }}
                  >
                    <TypingText
                      text={PROSE_A}
                      active
                      speed={12}
                      onComplete={() => setPhase('pauseA')}
                    />
                  </motion.div>
                )}
                {showProseB && (
                  <motion.div
                    key="proseB"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.4 }}
                  >
                    <TypingText
                      text={PROSE_B}
                      active
                      speed={12}
                      onComplete={() => setPhase('done')}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export const PromptEditorAnimation: React.FC<PromptEditorAnimationProps> = ({ isActive }) => {
  const [playKey, setPlayKey] = useState(0);

  useEffect(() => {
    if (isActive) setPlayKey((k) => k + 1);
  }, [isActive]);

  return (
    <motion.div
      className="landing-anim-frame"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={isActive ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.4 }}
    >
      {isActive && <PromptEditorContent key={playKey} />}
    </motion.div>
  );
};
