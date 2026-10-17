import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/**
 * The current time, updated on the next whole `stepMs` (default: every 5 s)
 * and when the app returns to the foreground, so countdowns tick on time.
 */
export function useNow(stepMs = 5_000): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(Date.now());
      timer = setTimeout(tick, stepMs - (Date.now() % stepMs) + 20);
    };
    timer = setTimeout(tick, stepMs - (Date.now() % stepMs) + 20);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && setNow(Date.now()));
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, [stepMs]);
  return now;
}
