import { useEffect, useRef } from 'react';

/**
 * setInterval with a callback that can change without resetting the timer.
 * Pass a null delay to pause.
 */
export default function useInterval(callback, delay) {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delay === null || delay === undefined) return undefined;
    const id = setInterval(() => savedCallback.current(), delay);
    return () => clearInterval(id);
  }, [delay]);
}
