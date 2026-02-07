import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Globe } from '../../../components/icons';
import './LandingAnimations.css';

interface TranslationAnimationProps {
  isActive: boolean;
}

const SPRING = { type: 'spring' as const, stiffness: 400, damping: 30 };

type Phase = 'source' | 'action' | 'click' | 'thinking' | 'target' | 'done';

const TranslationContent: React.FC = () => {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>('source');

  const sourceText = t('landing.translation.anim.sourceText');
  const sourceLang = t('landing.translation.anim.sourceLang');
  const targetText = t('landing.translation.anim.targetText');
  const buttonLabel = t('landing.translation.anim.buttonLabel');

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    switch (phase) {
      case 'action':
        timer = setTimeout(() => setPhase('click'), 500);
        break;
      case 'click':
        timer = setTimeout(() => setPhase('thinking'), 200);
        break;
      case 'thinking':
        timer = setTimeout(() => setPhase('target'), 700);
        break;
      default:
        return;
    }
    return () => clearTimeout(timer);
  }, [phase]);

  const showAction = phase !== 'source';
  const showTyping = phase === 'thinking';
  const showTarget = phase === 'target' || phase === 'done';

  return (
    <>
      {/* Source text bubble */}
      <motion.div
        className="landing-anim-bubble landing-anim-bubble--assistant"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ...SPRING }}
        onAnimationComplete={() => setPhase('action')}
      >
        <span className="landing-anim-prose" lang={sourceLang}>{sourceText}</span>
      </motion.div>

      {/* Action bar */}
      {showAction && (
        <motion.div
          className="landing-anim-action-bar"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          <motion.button
            className="landing-anim-action-btn"
            type="button"
            tabIndex={-1}
            animate={phase === 'click' ? { scale: [1, 0.92, 1] } : {}}
            transition={{ duration: 0.25 }}
          >
            <Globe size="sm" /> {buttonLabel}
          </motion.button>
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

      {/* Target translation */}
      <AnimatePresence>
        {showTarget && (
          <motion.div
            className="landing-anim-bubble landing-anim-bubble--assistant"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ...SPRING }}
            onAnimationComplete={() => setPhase('done')}
          >
            <span className="landing-anim-prose">{targetText}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export const TranslationAnimation: React.FC<TranslationAnimationProps> = ({ isActive }) => {
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
      {isActive && <TranslationContent key={playKey} />}
    </motion.div>
  );
};
