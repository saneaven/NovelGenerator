/**
 * Creates a throttled version of a function that limits how often it can be called.
 *
 * @param fn - The function to throttle
 * @param delay - Minimum time (ms) between function calls
 * @returns Throttled function with flush() and cancel() methods
 */
export function throttle<T extends (...args: any[]) => void>(
  fn: T,
  delay: number
): T & { flush: () => void; cancel: () => void } {
  let lastCall = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<T> | null = null;

  const throttled = (...args: Parameters<T>) => {
    lastArgs = args;
    const now = Date.now();
    const remaining = delay - (now - lastCall);

    if (remaining <= 0) {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      lastCall = now;
      fn(...args);
    } else if (!timeoutId) {
      timeoutId = setTimeout(() => {
        lastCall = Date.now();
        timeoutId = null;
        if (lastArgs) fn(...lastArgs);
      }, remaining);
    }
  };

  throttled.flush = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (lastArgs) {
      lastCall = Date.now();
      fn(...lastArgs);
      lastArgs = null;
    }
  };

  throttled.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    lastArgs = null;
  };

  return throttled as T & { flush: () => void; cancel: () => void };
}
