import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { TypingText } from './TypingText';
import './LandingAnimations.css';

interface AboutAnimationProps {
  isActive: boolean;
}

const SPRING = { type: 'spring' as const, stiffness: 400, damping: 30 };

const USER_MSG = 'Create characters for my dark fantasy novel';
const AI_RESPONSE = 'Here are two characters for your story:';

interface CardData {
  name: string;
  description: string;
}

const CARDS: CardData[] = [
  {
    name: 'Seraphina Veil',
    description:
      'A reclusive scholar cursed with forbidden sight, walking the boundary between mortal realm and shadow court.',
  },
  {
    name: 'Kael Duskborn',
    description:
      'Once a decorated knight, now bound to darkness after a betrayal that cost him everything but his blade.',
  },
];

type Phase =
  | 'inputTyping'
  | 'messageSent'
  | 'thinking'
  | 'aiResponse'
  | 'cardsReveal'
  | 'cardsFilling'
  | 'done';

/* ------------------------------------------------------------------ */

interface ToolCallCardProps {
  card: CardData;
  active: boolean;
  complete: boolean;
  delay: number;
  onComplete: () => void;
}

const ToolCallCard: React.FC<ToolCallCardProps> = ({
  card,
  active,
  complete,
  delay,
  onComplete,
}) => {
  return (
    <motion.div
      className="landing-anim-about-op-card"
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35, delay, ...SPRING }}
    >
      <div className="landing-anim-about-op-card__header">
        <div className="landing-anim-about-op-card__title-row">
          <h4 className="landing-anim-about-op-card__title">{card.name}</h4>
        </div>
        <span className="landing-anim-about-op-card__status">{complete ? 'Done' : 'Creating'}</span>
      </div>

      <div className="landing-anim-about-op-card__body">
        <div className="landing-anim-about-op-card__value">
          <TypingText
            text={card.description}
            active={active}
            speed={18}
            onComplete={onComplete}
          />
        </div>
      </div>
    </motion.div>
  );
};

/* ------------------------------------------------------------------ */

const AboutContent: React.FC = () => {
  const [phase, setPhase] = useState<Phase>('inputTyping');
  const [card1Active, setCard1Active] = useState(false);
  const [card2Active, setCard2Active] = useState(false);
  const completedCards = useRef(0);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    switch (phase) {
      case 'messageSent':
        timer = setTimeout(() => setPhase('thinking'), 400);
        break;
      case 'thinking':
        timer = setTimeout(() => setPhase('aiResponse'), 700);
        break;
      case 'cardsReveal':
        timer = setTimeout(() => {
          setPhase('cardsFilling');
          setCard1Active(true);
        }, 400);
        break;
    }

    return () => clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase === 'cardsFilling' && card1Active && !card2Active) {
      const timer = setTimeout(() => setCard2Active(true), 1000);
      return () => clearTimeout(timer);
    }
  }, [phase, card1Active, card2Active]);

  const handleCardComplete = useCallback(() => {
    completedCards.current += 1;
    if (completedCards.current >= 2) {
      setPhase('done');
    }
  }, []);

  const isInputting = phase === 'inputTyping';
  const showBubble = phase !== 'inputTyping';
  const showTyping = phase === 'thinking';
  const showAiResponse =
    phase !== 'inputTyping' &&
    phase !== 'messageSent' &&
    phase !== 'thinking';
  const showToolCard =
    phase === 'cardsReveal' || phase === 'cardsFilling' || phase === 'done';

  return (
    <div className="landing-anim-about-thread">
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

      <motion.div
        className="landing-anim-typing"
        animate={{ opacity: showTyping ? 1 : 0 }}
        transition={{ duration: 0.15 }}
      >
        <div className="landing-anim-typing-track">
          <div className="landing-anim-typing-bar" />
        </div>
      </motion.div>

      {showAiResponse && (
        <motion.div
          className="landing-anim-bubble landing-anim-bubble--assistant"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ...SPRING }}
        >
          <TypingText
            text={AI_RESPONSE}
            active
            speed={25}
            onComplete={() => setPhase('cardsReveal')}
          />
        </motion.div>
      )}

      {showToolCard && (
        <div className="landing-anim-about-call-stack">
          {card1Active && (
            <ToolCallCard
              card={CARDS[0]}
              active
              complete={phase === 'done' || card2Active}
              delay={0}
              onComplete={handleCardComplete}
            />
          )}
          {card2Active && (
            <ToolCallCard
              card={CARDS[1]}
              active
              complete={phase === 'done'}
              delay={0.08}
              onComplete={handleCardComplete}
            />
          )}
        </div>
      )}

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
    </div>
  );
};

/* ------------------------------------------------------------------ */

export const AboutAnimation: React.FC<AboutAnimationProps> = ({ isActive }) => {
  const [playKey, setPlayKey] = useState(0);

  useEffect(() => {
    if (isActive) setPlayKey((k) => k + 1);
  }, [isActive]);

  return (
    <motion.div
      className="landing-anim-frame landing-anim-frame--about landing-anim-about-wrapper"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={isActive ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.4 }}
    >
      {isActive && <AboutContent key={playKey} />}
    </motion.div>
  );
};
