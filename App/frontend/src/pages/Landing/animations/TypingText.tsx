import React, { useEffect, useRef, useState } from 'react';

interface TypingTextProps {
  text: string;
  active: boolean;
  speed?: number;
  className?: string;
  onComplete?: () => void;
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export const TypingText: React.FC<TypingTextProps> = ({
  text,
  active,
  speed = 30,
  className,
  onComplete,
}) => {
  const [charCount, setCharCount] = useState(0);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (!active) {
      setCharCount(0);
      return;
    }

    // Reduced motion: show full text immediately
    if (window.matchMedia?.(REDUCED_MOTION_QUERY).matches) {
      setCharCount(text.length);
      onCompleteRef.current?.();
      return;
    }

    let i = 0;
    const interval = setInterval(() => {
      i++;
      setCharCount(i);
      if (i >= text.length) {
        clearInterval(interval);
        onCompleteRef.current?.();
      }
    }, speed);

    return () => clearInterval(interval);
  }, [active, text, speed]);

  const done = charCount >= text.length;

  return (
    <span className={className}>
      {text.slice(0, charCount)}
      {active && !done && <span className="landing-anim-cursor" />}
    </span>
  );
};
