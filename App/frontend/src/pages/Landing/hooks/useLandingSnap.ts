import { useCallback, useEffect, useState } from 'react';

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mq: MediaQueryList = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!mq) return;

    const update = () => setPrefersReducedMotion(mq.matches);
    update();

    const mqWithEventTarget = mq as MediaQueryList & {
      addEventListener?: (type: string, listener: EventListenerOrEventListenerObject) => void;
      removeEventListener?: (type: string, listener: EventListenerOrEventListenerObject) => void;
    };
    if (typeof mqWithEventTarget.addEventListener === 'function' && typeof mqWithEventTarget.removeEventListener === 'function') {
      mqWithEventTarget.addEventListener('change', update);
      return () => mqWithEventTarget.removeEventListener?.('change', update);
    }

    // Safari < 14 fallback
    mq.addListener(update);
    return () => mq.removeListener(update);
  }, []);

  return prefersReducedMotion;
}

export function useLandingSnap({
  containerEl,
  sectionCount,
}: {
  containerEl: HTMLElement | null;
  sectionCount: number;
}) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!containerEl) return;

    if (typeof IntersectionObserver === 'undefined') {
      let rafId = 0;

      const update = () => {
        const height = containerEl.clientHeight || 1;
        const rawIndex = Math.round(containerEl.scrollTop / height);
        const clamped = clampInt(rawIndex, 0, Math.max(0, sectionCount - 1));
        setActiveIndex(clamped);
      };

      const onScroll = () => {
        if (rafId) return;
        rafId = window.requestAnimationFrame(() => {
          rafId = 0;
          update();
        });
      };

      containerEl.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll);
      update();

      return () => {
        if (rafId) window.cancelAnimationFrame(rafId);
        containerEl.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onScroll);
      };
    }

    const sections = Array.from(
      containerEl.querySelectorAll<HTMLElement>('[data-landing-index]')
    );
    if (sections.length === 0) return;

    const latestRatios = new Map<number, number>();
    const lastActiveRef = { current: -1 };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          const indexAttr = el.dataset.landingIndex;
          if (!indexAttr) continue;
          const index = Number(indexAttr);
          if (!Number.isFinite(index)) continue;
          latestRatios.set(index, entry.intersectionRatio);
        }

        let bestIndex = 0;
        let bestRatio = -1;
        for (const [index, ratio] of latestRatios.entries()) {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestIndex = index;
          }
        }

        const clamped = clampInt(bestIndex, 0, Math.max(0, sectionCount - 1));
        if (clamped === lastActiveRef.current) return;
        lastActiveRef.current = clamped;
        setActiveIndex(clamped);
      },
      {
        root: containerEl,
        threshold: [0, 0.25, 0.5, 0.75, 1],
      }
    );

    for (const section of sections) observer.observe(section);

    return () => observer.disconnect();
  }, [containerEl, sectionCount]);

  const scrollToIndex = useCallback(
    (index: number) => {
      if (!containerEl) return;

      const clamped = clampInt(index, 0, Math.max(0, sectionCount - 1));

      const target = containerEl.querySelector<HTMLElement>(`[data-landing-index="${clamped}"]`);
      if (target) {
        target.scrollIntoView({
          block: 'start',
          behavior: prefersReducedMotion ? 'auto' : 'smooth',
        });
        return;
      }

      const height = containerEl.clientHeight || 1;
      containerEl.scrollTo({
        top: clamped * height,
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
      });
    },
    [containerEl, prefersReducedMotion, sectionCount]
  );

  return { activeIndex, scrollToIndex, prefersReducedMotion };
}
