import { useEffect, useState } from 'react';

/**
 * Custom minimise / maximise / close buttons for the frameless window.
 *
 * macOS draws its own traffic lights, so these render on Windows and Linux
 * only. They also render nothing in a plain browser, where no bridge exists.
 */
export function WindowControls() {
  const bridge = window.nexus?.window;
  const isMac = window.nexus?.platform === 'darwin';
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!bridge) return;
    void bridge.isMaximized().then(setMaximized);
    return bridge.onMaximizedChanged(setMaximized);
  }, [bridge]);

  if (!bridge || isMac) return null;

  return (
    <div className="no-drag flex items-stretch">
      <ControlButton label="Minimise" onClick={() => void bridge.minimize()}>
        <line x1="1" y1="6" x2="11" y2="6" />
      </ControlButton>

      <ControlButton
        label={maximized ? 'Restore' : 'Maximise'}
        onClick={() => void bridge.toggleMaximize().then(setMaximized)}
      >
        {maximized ? (
          <>
            <rect x="1" y="3.5" width="7" height="7" />
            <polyline points="3.5,3.5 3.5,1 11,1 11,8.5 8.5,8.5" />
          </>
        ) : (
          <rect x="1.5" y="1.5" width="9" height="9" />
        )}
      </ControlButton>

      <ControlButton label="Close" onClick={() => void bridge.close()} danger>
        <line x1="1.5" y1="1.5" x2="10.5" y2="10.5" />
        <line x1="10.5" y1="1.5" x2="1.5" y2="10.5" />
      </ControlButton>
    </div>
  );
}

interface ControlButtonProps {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}

function ControlButton({ label, onClick, danger = false, children }: ControlButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`grid w-12 place-items-center text-slate-400 transition-colors ${
        danger ? 'hover:bg-red-500/90 hover:text-white' : 'hover:bg-white/10 hover:text-white'
      }`}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        shapeRendering="crispEdges"
      >
        {children}
      </svg>
    </button>
  );
}
