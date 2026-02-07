import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { TypingText } from './TypingText';
import './LandingAnimations.css';

interface AboutAnimationProps {
  isActive: boolean;
}

const SPRING = { type: 'spring' as const, stiffness: 400, damping: 30 };

const USER_MSG = 'Create a character: A mysterious librarian who guards ancient secrets';

type Phase = 'userTyping' | 'thinking' | 'card' | 'done';

const AboutContent: React.FC = () => {
  const [phase, setPhase] = useState<Phase>('userTyping');

  useEffect(() => {
    if (phase === 'thinking') {
      const t = setTimeout(() => setPhase('card'), 900);
      return () => clearTimeout(t);
    }
  }, [phase]);

  const showTyping = phase === 'thinking';
  const showCard = phase === 'card' || phase === 'done';

  return (
    <>
      {/* User message */}
      <motion.div
        className="landing-anim-bubble landing-anim-bubble--user"
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3, ...SPRING }}
      >
        <TypingText
          text={USER_MSG}
          active
          speed={25}
          onComplete={() => setPhase('thinking')}
        />
      </motion.div>

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

      {/* Assistant bubble with character card */}
      {showCard && (
        <motion.div
          className="landing-anim-bubble landing-anim-bubble--assistant"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ...SPRING }}
        >
          <div className="landing-anim-char-card">
            <motion.div
              className="landing-anim-avatar"
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1, duration: 0.3, ...SPRING }}
            >
              EV
            </motion.div>
            <div className="landing-anim-char-info">
              <motion.div
                className="landing-anim-char-name"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2, duration: 0.2 }}
              >
                Eleanor Voss
              </motion.div>
              <motion.div
                className="landing-anim-char-role"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3, duration: 0.2 }}
              >
                Librarian / Secret Keeper
              </motion.div>
              <motion.div
                className="landing-anim-char-desc"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4, duration: 0.2 }}
                onAnimationComplete={() => setPhase('done')}
              >
                A reclusive scholar who has dedicated her life to protecting forbidden knowledge hidden within the Archive's deepest vaults.
              </motion.div>
            </div>
          </div>
        </motion.div>
      )}
    </>
  );
};

export const AboutAnimation: React.FC<AboutAnimationProps> = ({ isActive }) => {
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
      {isActive && <AboutContent key={playKey} />}
    </motion.div>
  );
};
