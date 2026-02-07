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
  gradient: string;
}

const CARDS: CardData[] = [
  {
    name: 'Seraphina Veil',
    description:
      'A reclusive scholar cursed with forbidden sight, walking the boundary between mortal realm and shadow court.',
    gradient: 'linear-gradient(135deg, #2d1b69 0%, #11243e 100%)',
  },
  {
    name: 'Kael Duskborn',
    description:
      'Once a decorated knight, now bound to darkness after a betrayal that cost him everything but his blade.',
    gradient: 'linear-gradient(135deg, #1a3a2a 0%, #0d2137 100%)',
  },
];

type Phase =
  | 'userTyping'
  | 'thinking'
  | 'aiResponse'
  | 'cardsReveal'
  | 'cardsFilling'
  | 'done';

/* ------------------------------------------------------------------ */

interface MiniStoryCardProps {
  card: CardData;
  fillActive: boolean;
  delay: number;
  onComplete: () => void;
}

const MiniStoryCard: React.FC<MiniStoryCardProps> = ({
  card,
  fillActive,
  delay,
  onComplete,
}) => {
  const [showDesc, setShowDesc] = useState(false);

  return (
    <motion.div
      className="landing-anim-story-card"
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35, delay, ...SPRING }}
    >
      <div
        className="landing-anim-story-card__image"
        style={{ background: card.gradient }}
      />
      <div className="landing-anim-story-card__content">
        <motion.div
          className="landing-anim-story-card__title"
          initial={{ opacity: 0, y: 6 }}
          animate={fillActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 6 }}
          transition={{ duration: 0.25, delay: 0.1 }}
          onAnimationComplete={() => {
            if (fillActive) setShowDesc(true);
          }}
        >
          {card.name}
        </motion.div>
        <div className="landing-anim-story-card__desc">
          <TypingText
            text={card.description}
            active={showDesc}
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
  const [phase, setPhase] = useState<Phase>('userTyping');
  const [card1Active, setCard1Active] = useState(false);
  const [card2Active, setCard2Active] = useState(false);
  const completedCards = useRef(0);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    switch (phase) {
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

  const showTyping = phase === 'thinking';
  const showAiResponse = phase !== 'userTyping' && phase !== 'thinking';
  const showCards =
    phase === 'cardsReveal' || phase === 'cardsFilling' || phase === 'done';

  return (
    <>
      {/* ===== Chat Frame ===== */}
      <div className="landing-anim-frame">
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
      </div>

      {/* ===== Card Zone (outside chat frame) ===== */}
      {showCards && (
        <motion.div
          className="landing-anim-about-cards"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
        >
          <MiniStoryCard
            card={CARDS[0]}
            fillActive={card1Active}
            delay={0}
            onComplete={handleCardComplete}
          />
          <MiniStoryCard
            card={CARDS[1]}
            fillActive={card2Active}
            delay={0.1}
            onComplete={handleCardComplete}
          />
        </motion.div>
      )}
    </>
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
      className="landing-anim-about-wrapper"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={
        isActive ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.98 }
      }
      transition={{ duration: 0.4 }}
    >
      {isActive && <AboutContent key={playKey} />}
    </motion.div>
  );
};
