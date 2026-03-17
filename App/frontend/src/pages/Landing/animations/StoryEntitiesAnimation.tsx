import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AIAssistMini,
  Image as ImageIcon,
  Plus,
} from '../../../components/icons';
import { TypingText } from './TypingText';
import './LandingAnimations.css';

interface StoryEntitiesAnimationProps {
  isActive: boolean;
}

const SPRING = { type: 'spring' as const, stiffness: 340, damping: 28 };
const INITIAL_HOLD_MS = 2200;
const CUT_HOLD_MS = 850;
const SUMMARY = 'Archivist tracking a sealed manuscript beneath the royal library.';
const DETAIL =
  'Lead archivist of the Obsidian Annex. Calm under pressure, relentlessly curious, and willing to bargain with dangerous knowledge if it leads her to the truth.';
const PROMPT =
  'Painterly portrait, obsidian coat, silver sigil clasp, dim cathedral light, focused gaze, dark fantasy palette.';

type Cut = 'panel' | 'editor' | 'image' | 'result';

function Stage({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <motion.div
      key={id}
      className="landing-anim-ui-stage"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.26, ...SPRING }}
    >
      {children}
    </motion.div>
  );
}

function Tabs() {
  const tabs = [
    { label: 'Basic Info', active: false },
    { label: 'Characters', active: true },
    { label: 'Organizations', active: false },
    { label: 'Locations', active: false },
    { label: 'Lorebook', active: false },
  ];

  return (
    <div className="landing-anim-ui-tabs">
      {tabs.map((tab, index) => {
        return (
          <motion.div
            key={tab.label}
            className={`landing-anim-ui-tab${tab.active ? ' is-active' : ''}`}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.06, duration: 0.2, ...SPRING }}
          >
            <span>{tab.label}</span>
          </motion.div>
        );
      })}
    </div>
  );
}

function ObjectCard({
  name,
  summary,
  type,
  image = false,
  selected = false,
}: {
  name: string;
  summary: string;
  type: string;
  image?: boolean;
  selected?: boolean;
}) {
  return (
    <div className={`landing-anim-ui-object-card${selected ? ' is-selected' : ''}${image ? '' : ' no-image'}`}>
      {image && (
        <div className="landing-anim-ui-object-visual has-image">
          <div className="landing-anim-object-portrait">
            <div className="landing-anim-object-portrait__glow" />
          </div>
        </div>
      )}
      <div className="landing-anim-ui-object-copy">
        <div className="landing-anim-ui-object-meta">
          <span>{type}</span>
        </div>
        <strong>{name}</strong>
        <p>{summary}</p>
      </div>
    </div>
  );
}

function PanelCut({ withImage }: { withImage: boolean }) {
  return (
    <Stage id={withImage ? 'story-result' : 'story-panel'}>
      <div className="landing-anim-ui-app">
        <Tabs />
        <div className="landing-anim-ui-body landing-anim-story-entities-body">
          <div className="landing-anim-ui-bar">
            <strong>Characters</strong>
            <span className="landing-anim-ui-button secondary">
              <Plus size="sm" />
              Add
            </span>
          </div>
          <div className="landing-anim-ui-grid">
            <ObjectCard name="Eleanor Voss" summary={SUMMARY} type="Character" image={withImage} selected />
            <ObjectCard
              name="Kael Duskborn"
              summary="Ex-knight guarding the vault after a failed rebellion."
              type="Character"
            />
          </div>
        </div>
      </div>
    </Stage>
  );
}

function EditorCut({ onDone }: { onDone: () => void }) {
  return (
    <Stage id="story-editor">
      <div className="landing-anim-ui-panel landing-anim-story-entities-panel">
        <div className="landing-anim-ui-panel-tabs">
          <span className="landing-anim-ui-panel-tab is-active">Edit</span>
          <span className="landing-anim-ui-panel-tab">Image</span>
        </div>
        <div className="landing-anim-ui-panel-body landing-anim-story-entities-panel-body">
          <div className="landing-anim-ui-field">
            <label>Name</label>
            <div className="landing-anim-ui-input">Eleanor Voss</div>
          </div>
          <div className="landing-anim-ui-field">
            <label>Summary</label>
            <div className="landing-anim-ui-input">{SUMMARY}</div>
          </div>
          <div className="landing-anim-ui-field grow">
            <label>Content</label>
            <div className="landing-anim-ui-editor-box">
              <TypingText text={DETAIL} active speed={20} onComplete={onDone} />
            </div>
          </div>
          <div className="landing-anim-ui-actions">
            <span className="landing-anim-ui-button secondary">
              <AIAssistMini size="sm" />
              AI Edit
            </span>
          </div>
        </div>
      </div>
    </Stage>
  );
}

function ImageCut({ onDone }: { onDone: () => void }) {
  return (
    <Stage id="story-image">
      <div className="landing-anim-ui-panel landing-anim-story-entities-panel">
        <div className="landing-anim-ui-panel-tabs">
          <span className="landing-anim-ui-panel-tab">Edit</span>
          <span className="landing-anim-ui-panel-tab is-active">Image</span>
        </div>
        <div className="landing-anim-ui-panel-body landing-anim-story-entities-panel-body">
          <div className="landing-anim-ui-bar">
            <div className="landing-anim-ui-subtabs">
              <span className="landing-anim-ui-subtab">Library</span>
              <span className="landing-anim-ui-subtab is-active">Prompt</span>
            </div>
            <span className="landing-anim-ui-button primary">
              <ImageIcon size="sm" />
              Generate
            </span>
          </div>
          <div className="landing-anim-ui-field grow">
            <label>Natural Language Prompt</label>
            <div className="landing-anim-ui-editor-box">
              <TypingText text={PROMPT} active speed={18} onComplete={onDone} />
            </div>
          </div>
        </div>
      </div>
    </Stage>
  );
}

const StoryEntitiesContent: React.FC = () => {
  const [cut, setCut] = useState<Cut>('panel');
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
    if (cut !== 'panel') return;
    const timer = window.setTimeout(() => setCut('editor'), INITIAL_HOLD_MS);
    timeoutIdsRef.current.push(timer);
    return () => window.clearTimeout(timer);
  }, [cut]);

  const current = useMemo(() => {
    if (cut === 'panel') return <PanelCut withImage={false} />;
    if (cut === 'editor') {
      return <EditorCut onDone={() => scheduleCut('editor', 'image')} />;
    }
    if (cut === 'image') {
      return <ImageCut onDone={() => scheduleCut('image', 'result')} />;
    }
    return <PanelCut withImage />;
  }, [cut]);

  return <AnimatePresence mode="wait">{current}</AnimatePresence>;
};

export const StoryEntitiesAnimation: React.FC<StoryEntitiesAnimationProps> = ({ isActive }) => {
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
      {isActive && <StoryEntitiesContent key={playKey} />}
    </motion.div>
  );
};
