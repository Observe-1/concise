import { useEffect, useState } from 'react';

/** Live `window.innerHeight`, updating on resize/orientation change — so a
 *  fullscreen chart sized from it doesn't stay stale after a phone rotation. */
export function useViewportHeight(): number {
  const [height, setHeight] = useState(() => window.innerHeight);
  useEffect(() => {
    const onResize = () => setHeight(window.innerHeight);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);
  return height;
}
