import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MotionConfig } from 'motion/react';
import { useAuthStore } from '../../store/authStore';
import { Loading } from '../../components/common/Loading';
import type { IconProps } from '../../components/icons';
import { IconButton } from '../../components/IconButton';
import { TextButton } from '../../components/TextButton';
import { LANDING_NEXT_ICON, LANDING_SECTIONS } from './sections';
import type { LandingBackgroundConfig, LandingSectionConfig } from './sections';
import { LandingBackground } from './components/LandingBackground';
import { useLandingSnap } from './hooks/useLandingSnap';
import './Landing.css';
import { getResourceUrl } from '../../utils/resourceUrl';

function isSplitSection(section: LandingSectionConfig): section is Extract<LandingSectionConfig, { layout: 'split' }> {
  return section.layout === 'split';
}

function isCenterSection(section: LandingSectionConfig): section is Extract<LandingSectionConfig, { layout: 'center' }> {
  return section.layout === 'center';
}

function isImageBackground(
  bg: LandingBackgroundConfig
): bg is Extract<LandingBackgroundConfig, { type: 'image' }> {
  return bg.type === 'image';
}

function getIsMobileViewport() {
  if (typeof window === 'undefined') return false;
  if (!window.matchMedia) return false;
  return window.matchMedia('(max-width: 768px)').matches;
}

function resolveResponsiveBackground(
  background: LandingBackgroundConfig,
  isMobileViewport: boolean
): LandingBackgroundConfig {
  if (background.type !== 'image') return background;
  const resolvedFileName =
    isMobileViewport && background.mobileFileName ? background.mobileFileName : background.fileName;
  if (resolvedFileName === background.fileName) return background;
  return { type: 'image', fileName: resolvedFileName };
}

function easeOutCubic(value: number) {
  const t = Math.max(0, Math.min(1, value));
  return 1 - Math.pow(1 - t, 3);
}


const Landing: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isAuthenticated, checkAuth } = useAuthStore();
  const preloadImagesRef = useRef<HTMLImageElement[]>([]);

  const [isChecking, setIsChecking] = useState(true);
  const [isMobileViewport, setIsMobileViewport] = useState(getIsMobileViewport);

  useEffect(() => {
    const verifyAuth = async () => {
      await checkAuth();
      setIsChecking(false);
    };
    verifyAuth();
  }, [checkAuth]);

  // Detect mobile viewport for hero background selection.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;

    const mediaQuery = window.matchMedia('(max-width: 768px)');
    const onChange = () => setIsMobileViewport(mediaQuery.matches);

    onChange();
    mediaQuery.addEventListener('change', onChange);
    return () => mediaQuery.removeEventListener('change', onChange);
  }, []);

  // Preload landing background images (best-effort).
  useEffect(() => {
    const images = LANDING_SECTIONS
      .map((s) => s.background)
      .map((bg) => resolveResponsiveBackground(bg, isMobileViewport))
      .filter(isImageBackground)
      .map((bg) => getResourceUrl(bg.fileName));

    const preloads: HTMLImageElement[] = [];

    images.forEach((src) => {
      const img = new Image();
      img.decoding = 'async';
      img.src = src;
      img.decode?.().catch(() => null);
      preloads.push(img);
    });

    preloadImagesRef.current = preloads;
  }, [isMobileViewport]);

  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const [scrollProgress, setScrollProgress] = useState(0);
  const { activeIndex, scrollToIndex, prefersReducedMotion } = useLandingSnap({
    containerEl,
    sectionCount: LANDING_SECTIONS.length,
  });

  const activeSection = LANDING_SECTIONS[activeIndex] ?? LANDING_SECTIONS[0];
  const dotsHidden = activeSection.id === 'hero' || activeSection.id === 'cta';
  const heroIndex = LANDING_SECTIONS.findIndex((section) => section.id === 'hero');
  const heroNextSection = heroIndex >= 0 ? LANDING_SECTIONS[heroIndex + 1] : undefined;
  const heroUnderlay =
    heroNextSection?.background.type === 'surface'
      ? `var(${heroNextSection.background.cssVar})`
      : 'var(--color-surface-base)';
  useEffect(() => {
    if (!containerEl) return;

    let rafId = 0;
    let lastScrollTop = -1;

    const update = () => {
      rafId = 0;
      const sectionHeight = containerEl.clientHeight || 1;
      const scrollTop = containerEl.scrollTop;
      setScrollProgress(scrollTop / sectionHeight);

      if (scrollTop !== lastScrollTop) {
        lastScrollTop = scrollTop;
        rafId = window.requestAnimationFrame(update);
      }
    };

    const onScroll = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(update);
    };

    containerEl.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    window.visualViewport?.addEventListener('resize', onScroll);
    update();

    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      containerEl.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      window.visualViewport?.removeEventListener('resize', onScroll);
    };
  }, [containerEl]);

  const maxIndex = Math.max(0, LANDING_SECTIONS.length - 1);
  const clampedProgress = Math.max(0, Math.min(maxIndex, scrollProgress));
  const fromIndex = Math.floor(clampedProgress);
  const toIndex = Math.min(maxIndex, fromIndex + 1);
  const rawBlend = clampedProgress - fromIndex;
  const blend = prefersReducedMotion ? (rawBlend >= 0.5 ? 1 : 0) : easeOutCubic(rawBlend);

  const fromSection = LANDING_SECTIONS[fromIndex] ?? LANDING_SECTIONS[0];
  const toSection = LANDING_SECTIONS[toIndex] ?? LANDING_SECTIONS[0];

  const fromBackground = useMemo(
    () => resolveResponsiveBackground(fromSection.background, isMobileViewport),
    [fromSection.background, isMobileViewport]
  );
  const toBackground = useMemo(
    () => resolveResponsiveBackground(toSection.background, isMobileViewport),
    [toSection.background, isMobileViewport]
  );

  const NextIcon = LANDING_NEXT_ICON as React.FC<IconProps>;

  if (isChecking) {
    return (
      <div className="landing-loading">
        <Loading size="lg" />
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <MotionConfig reducedMotion="user" transition={{ duration: prefersReducedMotion ? 0 : 0.8, ease: 'easeInOut' }}>
      <div
        className="landing"
        data-active-tone={activeSection.tone}
        data-active-section={activeSection.id}
        style={
          {
            '--landing-progress': String(clampedProgress),
            '--landing-hero-underlay': heroUnderlay,
          } as React.CSSProperties
        }
      >
        <LandingBackground
          fromBackground={fromBackground}
          toBackground={toBackground}
          blend={blend}
          prefersReducedMotion={prefersReducedMotion}
        />

        <div className="landing-scroll" ref={setContainerEl}>
          {LANDING_SECTIONS.map((section, index) => (
            <section
              key={section.id}
              className={`landing-section landing-section--${section.layout}${section.id === 'hero' ? ' landing-section--hero' : ''}`}
              data-tone={section.tone}
              data-landing-index={index}
              aria-label={isSplitSection(section) ? t(section.left.titleKey) : t(section.center.titleKey)}
            >
              {isCenterSection(section) && section.id === 'hero' ? (
                <div className="landing-hero">
                  <div className="landing-hero-spacer" aria-hidden="true" />

                  <div className="landing-hero-bar">
                    <div className="landing-section-inner landing-hero-bar-inner">
                      <div className="landing-hero-text">
                        {(() => {
                          const Heading = index === 0 ? 'h1' : 'h2';
                          return <Heading className="landing-title landing-hero-title">{t(section.center.titleKey)}</Heading>;
                        })()}
                        {section.center.subtitleKey && (
                          <p className="landing-subtitle landing-hero-subtitle">{t(section.center.subtitleKey)}</p>
                        )}
                      </div>

                      {section.center.ctas.length > 0 && (
                        <div className="landing-cta landing-cta--hero">
                          {section.center.ctas.map((cta) => (
                            <TextButton
                              key={`${cta.to}:${cta.labelKey}`}
                              variant={cta.variant}
                              size="lg"
                              onClick={() => navigate(cta.to)}
                            >
                              {t(cta.labelKey)}
                            </TextButton>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="landing-section-inner">
                  {isSplitSection(section) && (
                    <div className="landing-split">
                      <div className="landing-left">
                        {(() => {
                          const Heading = index === 0 ? 'h1' : 'h2';
                          return <Heading className="landing-title">{t(section.left.titleKey)}</Heading>;
                        })()}
                        {section.left.subtitleKey && <p className="landing-subtitle">{t(section.left.subtitleKey)}</p>}
                        {section.left.bodyKey && <p className="landing-body">{t(section.left.bodyKey)}</p>}

                        {section.left.ctas && section.left.ctas.length > 0 && (
                          <div className="landing-cta">
                            {section.left.ctas.map((cta) => (
                              <TextButton
                                key={`${cta.to}:${cta.labelKey}`}
                                variant={cta.variant}
                                size="lg"
                                onClick={() => navigate(cta.to)}
                              >
                                {t(cta.labelKey)}
                              </TextButton>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="landing-right" aria-hidden="true">
                        {section.right.type === 'icon' && (
                          <div className="landing-right-icon">
                            <section.right.icon size="4xl" />
                          </div>
                        )}

                        {section.right.type === 'featureCards' && (
                          <div className="landing-feature-grid">
                            {section.right.cards.map((card) => (
                              <div key={card.titleKey} className="landing-feature-card">
                                <div className="landing-feature-icon">
                                  <card.icon size="2xl" />
                                </div>
                                <div className="landing-feature-text">
                                  <h3 className="landing-feature-title">{t(card.titleKey)}</h3>
                                  <p className="landing-feature-desc">{t(card.descriptionKey)}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {isCenterSection(section) && (
                    <div className="landing-center">
                      {(() => {
                        const Heading = index === 0 ? 'h1' : 'h2';
                        return <Heading className="landing-title">{t(section.center.titleKey)}</Heading>;
                      })()}
                      {section.center.subtitleKey && <p className="landing-subtitle">{t(section.center.subtitleKey)}</p>}
                      {section.center.ctas.length > 0 && (
                        <div className="landing-cta landing-cta--center">
                          {section.center.ctas.map((cta) => (
                            <TextButton
                              key={`${cta.to}:${cta.labelKey}`}
                              variant={cta.variant}
                              size="lg"
                              onClick={() => navigate(cta.to)}
                            >
                              {t(cta.labelKey)}
                            </TextButton>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </section>
          ))}
        </div>

        <nav className={`landing-dots${dotsHidden ? ' is-hidden' : ''}`} aria-label="Landing sections" aria-hidden={dotsHidden}>
          {LANDING_SECTIONS.map((section, index) => (
            <button
              key={section.id}
              type="button"
              className={`landing-dot${index === activeIndex ? ' is-active' : ''}`}
              onClick={() => scrollToIndex(index)}
              aria-label={isSplitSection(section) ? t(section.left.titleKey) : t(section.center.titleKey)}
              aria-current={index === activeIndex ? 'true' : undefined}
              tabIndex={dotsHidden ? -1 : undefined}
            />
          ))}
        </nav>

        {activeIndex < LANDING_SECTIONS.length - 1 && (
          <IconButton
            className="landing-next"
            onClick={() => scrollToIndex(activeIndex + 1)}
            ariaLabel="Next section"
            icon={<NextIcon size="lg" />}
            size="md"
            variant="ghost"
          />
        )}
      </div>
    </MotionConfig>
  );
};

export default Landing;
