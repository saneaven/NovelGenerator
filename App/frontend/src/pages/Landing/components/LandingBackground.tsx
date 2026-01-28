import React, { useEffect, useRef } from 'react';
import type { LandingBackgroundConfig } from '../sections';
import { getResourceUrl } from '../../../utils/resourceUrl';

function backgroundEquals(a: LandingBackgroundConfig, b: LandingBackgroundConfig) {
  if (a.type !== b.type) return false;
  if (a.type === 'image' && b.type === 'image') return a.fileName === b.fileName;
  if (a.type === 'surface' && b.type === 'surface') return a.cssVar === b.cssVar;
  return false;
}

function backgroundStyle(bg: LandingBackgroundConfig): React.CSSProperties {
  if (bg.type === 'surface') return { backgroundColor: `var(${bg.cssVar})` };
  return { backgroundImage: `url(${getResourceUrl(bg.fileName)})` };
}

export function LandingBackground({
  fromBackground,
  toBackground,
  blend,
  prefersReducedMotion,
}: {
  fromBackground: LandingBackgroundConfig;
  toBackground: LandingBackgroundConfig;
  blend: number;
  prefersReducedMotion: boolean;
}) {
  const preloadImagesRef = useRef<HTMLImageElement[]>([]);
  const shouldRenderOverlay = !backgroundEquals(fromBackground, toBackground);
  const overlayOpacity = prefersReducedMotion ? (blend >= 0.5 ? 1 : 0) : blend;

  // Preload images (best-effort, avoids flicker on transition).
  useEffect(() => {
    const images: string[] = [];
    if (fromBackground.type === 'image') images.push(getResourceUrl(fromBackground.fileName));
    if (toBackground.type === 'image') images.push(getResourceUrl(toBackground.fileName));

    const preloads: HTMLImageElement[] = [];

    images.forEach((src) => {
      const img = new Image();
      img.decoding = 'async';
      img.src = src;
      img.decode?.().catch(() => null);
      preloads.push(img);
    });

    preloadImagesRef.current = preloads;
  }, [fromBackground, toBackground]);

  return (
    <div className="landing-bg" aria-hidden="true">
      <div className="landing-bg-layer landing-bg-layer--base" style={backgroundStyle(fromBackground)} />
      {shouldRenderOverlay && (
        <div
          className="landing-bg-layer landing-bg-layer--overlay"
          style={{ ...backgroundStyle(toBackground), opacity: overlayOpacity }}
        />
      )}

      <div className="landing-bg-scrim" />
    </div>
  );
}
