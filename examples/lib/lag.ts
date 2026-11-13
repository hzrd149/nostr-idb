import { useEffect, useState } from "react";

/**
 * Measures main-thread responsiveness: the longest gap between animation
 * frames over the last second. ~16ms is smooth; long database work on the
 * main thread shows up here as hundreds of milliseconds.
 */
export function useFrameLag(window = 1000) {
  const [lag, setLag] = useState(0);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let worst = 0;
    let windowStart = last;
    const frame = (now: number) => {
      worst = Math.max(worst, now - last);
      last = now;
      if (now - windowStart >= window) {
        setLag(Math.round(worst));
        worst = 0;
        windowStart = now;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [window]);

  return lag;
}
