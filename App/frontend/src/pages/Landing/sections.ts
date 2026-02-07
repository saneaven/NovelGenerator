import type React from 'react';
import type { IconProps } from '../../components/icons';
import { ChevronDown } from '../../components/icons';
import { AboutAnimation } from './animations/AboutAnimation';
import { AgentWritingAnimation } from './animations/AgentWritingAnimation';
import { AgentQueryAnimation } from './animations/AgentQueryAnimation';
import { TranslationAnimation } from './animations/TranslationAnimation';
import { PromptEditorAnimation } from './animations/PromptEditorAnimation';

export type LandingTone = 'base' | 'inverse' | 'onImage';

export type LandingBackgroundConfig =
  | { type: 'image'; fileName: string; mobileFileName?: string }
  | { type: 'surface'; cssVar: string };

export type LandingCtaVariant = 'primary' | 'secondary';

export type LandingCtaConfig = {
  to: string;
  labelKey: string;
  variant: LandingCtaVariant;
};

export type LandingFeatureCardConfig = {
  icon: React.FC<IconProps>;
  titleKey: string;
  descriptionKey: string;
};

export type LandingRightContentConfig =
  | { type: 'icon'; icon: React.FC<IconProps> }
  | { type: 'featureCards'; cards: LandingFeatureCardConfig[] }
  | { type: 'animation'; component: React.FC<{ isActive: boolean }> };

export type LandingSectionConfig =
  | {
      id: string;
      layout: 'split';
      tone: LandingTone;
      background: LandingBackgroundConfig;
      left: {
        titleKey: string;
        subtitleKey?: string;
        bodyKey?: string;
        ctas?: LandingCtaConfig[];
      };
      right: LandingRightContentConfig;
    }
  | {
      id: string;
      layout: 'center';
      tone: LandingTone;
      background: LandingBackgroundConfig;
      center: {
        titleKey: string;
        subtitleKey?: string;
        ctas: LandingCtaConfig[];
      };
    };

/**
 * Add/remove entries here to change the number of scroll-snap sections.
 */
export const LANDING_SECTIONS: LandingSectionConfig[] = [
  {
    id: 'hero',
    layout: 'center',
    tone: 'base',
    background: {
      type: 'image',
      fileName: 'main_background_wide.avif',
      mobileFileName: 'main_background_portrait.avif',
    },
    center: {
      titleKey: 'landing.hero.title',
      subtitleKey: 'landing.hero.subtitle',
      ctas: [
        { to: '/register', labelKey: 'landing.createAccount', variant: 'primary' },
        { to: '/login', labelKey: 'landing.signIn', variant: 'secondary' },
      ],
    },
  },
  {
    id: 'about',
    layout: 'split',
    tone: 'base',
    background: { type: 'surface', cssVar: '--color-surface-base' },
    left: {
      titleKey: 'landing.about.title',
      bodyKey: 'landing.about.description',
    },
    right: { type: 'animation', component: AboutAnimation },
  },
  {
    id: 'agentWriting',
    layout: 'split',
    tone: 'inverse',
    background: { type: 'surface', cssVar: '--color-surface-inverse' },
    left: {
      titleKey: 'landing.agentWriting.title',
      bodyKey: 'landing.agentWriting.description',
    },
    right: { type: 'animation', component: AgentWritingAnimation },
  },
  {
    id: 'agentQuery',
    layout: 'split',
    tone: 'base',
    background: { type: 'surface', cssVar: '--color-surface-base' },
    left: {
      titleKey: 'landing.agentQuery.title',
      bodyKey: 'landing.agentQuery.description',
    },
    right: { type: 'animation', component: AgentQueryAnimation },
  },
  {
    id: 'translation',
    layout: 'split',
    tone: 'inverse',
    background: { type: 'surface', cssVar: '--color-surface-inverse' },
    left: {
      titleKey: 'landing.translation.title',
      bodyKey: 'landing.translation.description',
    },
    right: { type: 'animation', component: TranslationAnimation },
  },
  {
    id: 'promptEditor',
    layout: 'split',
    tone: 'base',
    background: { type: 'surface', cssVar: '--color-surface-base' },
    left: {
      titleKey: 'landing.promptEditor.title',
      bodyKey: 'landing.promptEditor.description',
    },
    right: { type: 'animation', component: PromptEditorAnimation },
  },
  {
    id: 'cta',
    layout: 'center',
    tone: 'onImage',
    background: { type: 'image', fileName: 'main_end_background.avif' },
    center: {
      titleKey: 'landing.cta.title',
      subtitleKey: 'landing.cta.subtitle',
      ctas: [{ to: '/register', labelKey: 'landing.cta.signUp', variant: 'primary' }],
    },
  },
];

export const LANDING_NEXT_ICON = ChevronDown;
