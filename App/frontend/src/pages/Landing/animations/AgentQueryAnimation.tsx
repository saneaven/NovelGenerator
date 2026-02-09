import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { TypingText } from './TypingText';
import { Search, People, Lightning, Document } from '../../../components/icons';

import './LandingAnimations.css';

interface AgentQueryAnimationProps {
  isActive: boolean;
}

const SPRING = { type: 'spring' as const, stiffness: 400, damping: 30 };

const USER_MSG = 'What conflicts exist between Eleanor and the Council?';

const SEARCH_ITEMS = [
  { icon: <People size="sm" />, label: 'Eleanor Voss — Character Profile' },
  { icon: <Lightning size="sm" />, label: 'Council Confrontation — Event' },
  { icon: <Document size="sm" />, label: 'Chapter 2: The Tribunal — Scene' },
];

const REFERENCE_CHIPS = ['Ch.2', 'Eleanor', 'Council'];

const ANSWER =
  "Eleanor's primary conflict with the Council stems from her refusal to surrender the Archive's forbidden texts. In Chapter 2, the Tribunal demanded she relinquish access, but she invoked the Keeper's Oath — an ancient clause the Council had long forgotten.";

type Phase = 'inputTyping' | 'messageSent' | 'searching' | 'scan0' | 'scan1' | 'scan2' | 'refs' | 'answerTyping' | 'done';

const AgentQueryContent: React.FC = () => {
  const [phase, setPhase] = useState<Phase>('inputTyping');

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    switch (phase) {
      case 'messageSent':
        t = setTimeout(() => setPhase('searching'), 400);
        break;
      case 'searching':
        t = setTimeout(() => setPhase('scan0'), 300);
        break;
      case 'scan0':
        t = setTimeout(() => setPhase('scan1'), 400);
        break;
      case 'scan1':
        t = setTimeout(() => setPhase('scan2'), 400);
        break;
      case 'scan2':
        t = setTimeout(() => setPhase('refs'), 500);
        break;
      case 'refs':
        t = setTimeout(() => setPhase('answerTyping'), 600);
        break;
      default:
        return;
    }
    return () => clearTimeout(t);
  }, [phase]);

  const isInputting = phase === 'inputTyping';
  const showBubble = phase !== 'inputTyping';
  const showSearch =
    phase === 'searching' || phase === 'scan0' || phase === 'scan1' || phase === 'scan2';
  const highlightIndex =
    phase === 'scan0' ? 0 : phase === 'scan1' ? 1 : phase === 'scan2' ? 2 : -1;
  const showRefs =
    phase === 'refs' || phase === 'answerTyping' || phase === 'done';
  const showAnswer = phase === 'answerTyping' || phase === 'done';

  return (
    <>
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
              <Search size="sm" /> Searching story database...
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
      {showRefs && (
        <div className="landing-anim-chips">
          {REFERENCE_CHIPS.map((chip, i) => (
            <motion.span
              key={chip}
              className="landing-anim-ref-badge"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.1, duration: 0.2, ...SPRING }}
            >
              {chip}
            </motion.span>
          ))}
        </div>
      )}

      {/* Assistant answer */}
      {showAnswer && (
        <motion.div
          className="landing-anim-bubble landing-anim-bubble--assistant"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ...SPRING }}
        >
          <TypingText
            text={ANSWER}
            active
            speed={12}
            onComplete={() => setPhase('done')}
          />
        </motion.div>
      )}

      {/* Input bar */}
      <div className="landing-anim-input">
        {isInputting && (
          <TypingText
            text={USER_MSG}
            active
            speed={22}
            onComplete={() => setPhase('messageSent')}
          />
        )}
      </div>
    </>
  );
};

export const AgentQueryAnimation: React.FC<AgentQueryAnimationProps> = ({ isActive }) => {
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
      {isActive && <AgentQueryContent key={playKey} />}
    </motion.div>
  );
};
