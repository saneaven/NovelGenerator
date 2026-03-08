import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Image as ImageIcon, Search } from '../../../components/icons';
import { TypingText } from './TypingText';
import './LandingAnimations.css';

interface SceneImageAnimationProps {
  isActive: boolean;
}

const SPRING = { type: 'spring' as const, stiffness: 340, damping: 28 };
const INITIAL_HOLD_MS = 2200;
const CUT_HOLD_MS = 850;
const LIBRARY_CLICK_MS = 900;
const LIBRARY_ADVANCE_MS = 1450;
const REQUEST = 'Show the instant Eleanor breaks the seal while Kael enters the vault behind her.';
const PROMPT =
  'Cinematic underground archive, Eleanor at the lectern breaking a silver wax seal, Kael entering through the iron gate, dust in cold light.';

type Cut = 'editor' | 'prompt' | 'generate' | 'library' | 'inserted';

function Stage({
  id,
  className,
  children,
}: {
  id: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      key={id}
      className={`landing-anim-ui-stage${className ? ` ${className}` : ''}`}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.26, ...SPRING }}
    >
      {children}
    </motion.div>
  );
}

function EditorCut() {
  return (
    <Stage id="scene-editor" className="is-manuscript-cut">
      <div className="landing-anim-ui-panel manuscript">
        <motion.div
          className="landing-anim-ui-editor-toolbar"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ...SPRING }}
        >
          <motion.span
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.04, duration: 0.18 }}
          />
          <motion.span
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.09, duration: 0.18 }}
          />
          <motion.span
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.14, duration: 0.18 }}
          />
          <motion.strong
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.18, duration: 0.22 }}
          >
            Chapter 3
          </motion.strong>
        </motion.div>
        <div className="landing-anim-ui-manuscript edge-to-edge">
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.24, duration: 0.26, ...SPRING }}
          >
            Eleanor set the lantern beside the lectern and brushed dust from the silver seal.
          </motion.p>
          <motion.p
            className="is-active landing-anim-ui-manuscript-line-focus"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.38, duration: 0.28, ...SPRING }}
          >
            The wax gave way under her thumb as Kael pushed through the vault gate behind her.
          </motion.p>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.52, duration: 0.26, ...SPRING }}
          >
            Cold air moved through the archive, lifting the loose pages around the chamber.
          </motion.p>
        </div>
      </div>
    </Stage>
  );
}

function PromptCut({ onDone }: { onDone: () => void }) {
  return (
    <Stage id="scene-prompt">
      <div className="landing-anim-ui-panel">
        <div className="landing-anim-ui-panel-body">
          <div className="landing-anim-ui-bar">
            <strong>Scene Prompt</strong>
            <span className="landing-anim-search-header">
              <Search size="sm" />
              <span>Current Chapter</span>
            </span>
          </div>
          <div className="landing-anim-ui-chip-row">
            <span className="landing-anim-chip">Eleanor Voss</span>
            <span className="landing-anim-chip">Kael Duskborn</span>
            <span className="landing-anim-chip">The Archive</span>
          </div>
          <div className="landing-anim-ui-scene-lines">
            <span>Before: Eleanor finds the locked lectern beneath the vault.</span>
            <span>After: Kael hears the gate shift open behind the chamber wall.</span>
          </div>
          <div className="landing-anim-ui-field grow">
            <label>What do you want to visualize?</label>
            <div className="landing-anim-ui-editor-box">
              <TypingText text={REQUEST} active speed={18} onComplete={onDone} />
            </div>
          </div>
        </div>
      </div>
    </Stage>
  );
}

function GenerateCut({ onDone }: { onDone: () => void }) {
  return (
    <Stage id="scene-generate">
      <div className="landing-anim-ui-panel">
        <div className="landing-anim-ui-panel-body">
          <div className="landing-anim-ui-bar">
            <strong>Generate Image</strong>
            <span className="landing-anim-ui-button primary">
              <ImageIcon size="sm" />
              Generate
            </span>
          </div>

          <div className="landing-anim-ui-generate-layout">
            <div className="landing-anim-ui-field grow">
              <label>Prompt</label>
              <div className="landing-anim-ui-editor-box">
                <TypingText text={PROMPT} active speed={17} onComplete={onDone} />
              </div>
            </div>

            <div className="landing-anim-ui-info-stack">
              <div className="landing-anim-ui-field">
                <label>Provider</label>
                <div className="landing-anim-ui-select">OpenAI</div>
              </div>

              <div className="landing-anim-ui-field">
                <label>Resolution</label>
                <div className="landing-anim-ui-select">1024 x 1024</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Stage>
  );
}

function LibraryCut({ onDone }: { onDone: () => void }) {
  const [isPressed, setIsPressed] = useState(false);

  useEffect(() => {
    const pressTimer = window.setTimeout(() => setIsPressed(true), LIBRARY_CLICK_MS);
    const advanceTimer = window.setTimeout(onDone, LIBRARY_ADVANCE_MS);

    return () => {
      window.clearTimeout(pressTimer);
      window.clearTimeout(advanceTimer);
    };
  }, [onDone]);

  return (
    <Stage id="scene-library">
      <div className="landing-anim-ui-app">
        <div className="landing-anim-ui-body">
          <div className="landing-anim-ui-bar">
            <strong>Scene Library</strong>
            <span className="landing-anim-ui-chip">Current Chapter</span>
          </div>
          <div className="landing-anim-search">
            <div className="landing-anim-search-header">
              <Search size="sm" />
              <span>Search images...</span>
            </div>
          </div>
          <div className="landing-anim-ui-grid">
            <motion.div
              className="landing-anim-ui-scene-card image-only is-new"
              animate={
                isPressed
                  ? {
                      scale: [1, 0.965, 1],
                      y: [0, 1, 0],
                    }
                  : {
                      scale: 1,
                      y: 0,
                    }
              }
              transition={{ duration: 0.26 }}
            >
              <div className={`landing-anim-ui-scene-thumb ${isPressed ? 'is-selected' : ''}`}>
                <div className="landing-anim-scene-result__frame" />
              </div>
            </motion.div>
            <div className="landing-anim-ui-scene-card image-only">
              <div className="landing-anim-ui-scene-thumb muted" />
            </div>
          </div>
        </div>
      </div>
    </Stage>
  );
}

function InsertedCut() {
  return (
    <Stage id="scene-inserted" className="is-manuscript-cut">
      <div className="landing-anim-ui-panel manuscript">
        <div className="landing-anim-ui-editor-toolbar">
          <span />
          <span />
          <span />
          <strong>Chapter 3</strong>
        </div>
        <div className="landing-anim-ui-manuscript edge-to-edge">
          <p>Eleanor set the lantern beside the lectern and brushed dust from the silver seal.</p>
          <p className="is-active">The wax gave way under her thumb as Kael pushed through the vault gate behind her.</p>
          <motion.div
            className="landing-anim-ui-manuscript-media"
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.32, ...SPRING }}
          >
            <div className="landing-anim-ui-manuscript-media-frame">
              <div className="landing-anim-scene-result__frame" />
            </div>
          </motion.div>
          <p>Cold air moved through the archive, lifting the loose pages around the chamber.</p>
        </div>
      </div>
    </Stage>
  );
}

const SceneImageContent: React.FC = () => {
  const [cut, setCut] = useState<Cut>('editor');
  const timeoutIdsRef = useRef<number[]>([]);

  const scheduleCut = (from: Cut, to: Cut, delay = CUT_HOLD_MS) => {
    const timeoutId = window.setTimeout(() => {
      setCut((value) => (value === from ? to : value));
    }, delay);
    timeoutIdsRef.current.push(timeoutId);
  };

  useEffect(() => {
    return () => {
      timeoutIdsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
      timeoutIdsRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (cut !== 'editor') return;
    const timer = window.setTimeout(() => setCut('prompt'), INITIAL_HOLD_MS);
    timeoutIdsRef.current.push(timer);
    return () => window.clearTimeout(timer);
  }, [cut]);

  const current = useMemo(() => {
    if (cut === 'editor') return <EditorCut />;
    if (cut === 'prompt') {
      return <PromptCut onDone={() => scheduleCut('prompt', 'generate')} />;
    }
    if (cut === 'generate') {
      return <GenerateCut onDone={() => scheduleCut('generate', 'library')} />;
    }
    if (cut === 'library') {
      return <LibraryCut onDone={() => scheduleCut('library', 'inserted', 0)} />;
    }
    return <InsertedCut />;
  }, [cut]);

  return <AnimatePresence mode="wait">{current}</AnimatePresence>;
};

export const SceneImageAnimation: React.FC<SceneImageAnimationProps> = ({ isActive }) => {
  const [playKey, setPlayKey] = useState(0);

  useEffect(() => {
    if (isActive) setPlayKey((current) => current + 1);
  }, [isActive]);

  return (
    <motion.div
      className="landing-anim-frame"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={isActive ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.35 }}
    >
      {isActive && <SceneImageContent key={playKey} />}
    </motion.div>
  );
};
