import { useEffect } from "react";

export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !navigator.wakeLock) return;
    let lock: WakeLockSentinel | undefined;
    let generation = 0;
    const update = () => {
      const request = ++generation;
      if (document.hidden) {
        void lock?.release();
        lock = undefined;
        return;
      }
      void navigator.wakeLock
        .request("screen")
        .then((next) => {
          if (request !== generation) void next.release();
          else {
            void lock?.release();
            lock = next;
          }
        })
        .catch(() => {});
    };
    document.addEventListener("visibilitychange", update);
    update();
    return () => {
      generation++;
      document.removeEventListener("visibilitychange", update);
      void lock?.release();
    };
  }, [active]);
}
