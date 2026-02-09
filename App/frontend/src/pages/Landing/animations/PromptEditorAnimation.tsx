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
  | 'inputTyping'
  | 'messageSent'
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
      case 'messageSent':
        t = setTimeout(() => setPhase('thinking'), 400);
        break;
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

  const isInputting = phase === 'inputTyping';
  const showBubble = phase !== 'promptA' && phase !== 'inputTyping';
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
              if (phase === 'promptA') setPhase('inputTyping');
              if (phase === 'promptB') setPhase('proseB');
            }}
          >
            {currentPrompt}
          </motion.div>
        </AnimatePresence>
      </motion.div>

      {/* User message bubble */}
      {showBubble && (
        <motion.div
          className="landing-anim-bubble landing-anim-bubble--user"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ...SPRING }}
        >
          {USER_MSG}
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

      {/* Assistant prose */}
      {showProse && (
        <motion.div
          className={`landing-anim-bubble landing-anim-bubble--assistant ${isSecondary ? 'landing-anim-bubble--accent-b' : 'landing-anim-bubble--accent-a'}`}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ...SPRING }}
        >
          <span className="landing-anim-prose">
            <AnimatePresence mode="wait">
              {showProseA && (
                <motion.div
                  key="proseA"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
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
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
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
          </span>
        </motion.div>
      )}

      {/* Input bar */}
      <div className="landing-anim-input">
        {isInputting && (
          <TypingText
            text={USER_MSG}
            active
            speed={25}
            onComplete={() => setPhase('messageSent')}
          />
        )}
      </div>
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
