import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { TypingText } from './TypingText';
import './LandingAnimations.css';

interface AgentWritingAnimationProps {
  isActive: boolean;
}

const SPRING = { type: 'spring' as const, stiffness: 400, damping: 30 };

const CONTEXT_CHIPS = ['Eleanor Voss', 'The Archive', 'Chapter 3'];
const USER_MSG = 'Write the scene where Eleanor discovers the hidden manuscript';
const PROSE =
  'Eleanor traced her fingers along the cracked spine of the manuscript, its leather cover warm beneath her touch as if the words inside still breathed with a life of their own. The Archive had kept this secret for three hundred years — and now it trembled in her hands.';

type Phase = 'chips' | 'userTyping' | 'thinking' | 'proseTyping' | 'done';

const AgentWritingContent: React.FC = () => {
  const [phase, setPhase] = useState<Phase>('chips');

  useEffect(() => {
    if (phase === 'chips') {
      const t = setTimeout(() => setPhase('userTyping'), CONTEXT_CHIPS.length * 150 + 200);
      return () => clearTimeout(t);
    }
    if (phase === 'thinking') {
      const t = setTimeout(() => setPhase('proseTyping'), 900);
      return () => clearTimeout(t);
    }
  }, [phase]);

  const showUser = phase !== 'chips';
  const showTyping = phase === 'thinking';
  const showProse = phase === 'proseTyping' || phase === 'done';

  return (
    <>
      {/* Context chips */}
      <div className="landing-anim-chips">
        {CONTEXT_CHIPS.map((chip, i) => (
          <motion.span
            key={chip}
            className="landing-anim-chip"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.15, duration: 0.25, ...SPRING }}
          >
            {chip}
          </motion.span>
        ))}
      </div>

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
            speed={20}
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

      {/* Assistant bubble with prose */}
      {showProse && (
        <motion.div
          className="landing-anim-bubble landing-anim-bubble--assistant"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ...SPRING }}
          onAnimationComplete={() => setPhase('done')}
        >
          <span className="landing-anim-prose">{PROSE}</span>
        </motion.div>
      )}
    </>
  );
};

export const AgentWritingAnimation: React.FC<AgentWritingAnimationProps> = ({ isActive }) => {
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
      {isActive && <AgentWritingContent key={playKey} />}
    </motion.div>
  );
};
