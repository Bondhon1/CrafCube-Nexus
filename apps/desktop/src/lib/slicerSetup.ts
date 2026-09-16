import { useEffect, useState } from 'react';

/**
 * Live slicer setup state from the main process: whether the user already has
 * a slicer, and how far the background download has got if not.
 *
 * Null outside the desktop app, where there is no main process to ask.
 */
export function useSlicerSetup(): SlicerSetup | null {
  const [state, setState] = useState<SlicerSetup | null>(null);

  useEffect(() => {
    const bridge = window.nexus?.slicer;
    if (!bridge) return;
    let active = true;
    void bridge.status().then((initial) => { if (active) setState(initial); });
    const unsubscribe = bridge.onState((next) => { if (active) setState(next); });
    return () => { active = false; unsubscribe(); };
  }, []);

  return state;
}

export function downloadPercent(state: SlicerSetup | null): number | null {
  if (state?.phase !== 'downloading' || state.total <= 0) return null;
  return Math.min(100, Math.round((state.received / state.total) * 100));
}

/** One line describing where setup is, for places with little room. */
export function describeSetup(state: SlicerSetup | null): string | null {
  switch (state?.phase) {
    case 'downloading':
      return `Downloading the slicer — ${downloadPercent(state)}%`;
    case 'verifying':
      return 'Verifying the slicer download…';
    case 'extracting':
      return 'Unpacking the slicer…';
    case 'checking':
      return 'Looking for a slicer…';
    case 'failed':
      return 'Slicer setup failed';
    default:
      return null;
  }
}
