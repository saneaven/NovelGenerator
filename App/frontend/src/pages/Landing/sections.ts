import type React from 'react';
import type { IconProps } from '../../components/icons';
import { ChevronDown, DocumentAlt, Globe, Lightning, Scroll } from '../../components/icons';

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
  | { type: 'featureCards'; cards: LandingFeatureCardConfig[] };

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
    right: { type: 'icon', icon: DocumentAlt },
  },
  {
    id: 'features',
    layout: 'split',
    tone: 'inverse',
    background: { type: 'surface', cssVar: '--color-surface-inverse' },
    left: {
      titleKey: 'landing.features.title',
      bodyKey: 'landing.features.subtitle',
    },
    right: {
      type: 'featureCards',
      cards: [
        { icon: Lightning, titleKey: 'landing.features.ai.title', descriptionKey: 'landing.features.ai.description' },
        { icon: Scroll, titleKey: 'landing.features.organize.title', descriptionKey: 'landing.features.organize.description' },
        { icon: Globe, titleKey: 'landing.features.language.title', descriptionKey: 'landing.features.language.description' },
      ],
    },
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
