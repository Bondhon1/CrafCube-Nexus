interface MarkProps {
  className?: string;
}

/**
 * The hexagon-cube mark from the brand artwork: an outer hex ring enclosing an
 * isometric cube. Drawn as geometry rather than shipped as a bitmap so it stays
 * crisp at every size and inherits currentColor.
 */
export function LogoMark({ className = 'h-8 w-8' }: MarkProps) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="nexus-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0df8d0" />
          <stop offset="100%" stopColor="#0eb18d" />
        </linearGradient>
      </defs>

      {/* Outer hexagon ring */}
      <path
        d="M50 3 L91 26.5 L91 73.5 L50 97 L9 73.5 L9 26.5 Z"
        fill="none"
        stroke="url(#nexus-mark)"
        strokeWidth="9"
        strokeLinejoin="round"
      />

      {/* Isometric cube: top face lighter, two side faces darker */}
      <path d="M50 30 L69 41 L50 52 L31 41 Z" fill="url(#nexus-mark)" />
      <path d="M31 41 L50 52 L50 74 L31 63 Z" fill="url(#nexus-mark)" opacity="0.55" />
      <path d="M69 41 L69 63 L50 74 L50 52 Z" fill="url(#nexus-mark)" opacity="0.8" />
    </svg>
  );
}

interface WordmarkProps {
  className?: string;
  /** Stacks "Nexus" under "CrafCube", as in the full brand lockup. */
  stacked?: boolean;
}

export function Wordmark({ className = '', stacked = false }: WordmarkProps) {
  if (stacked) {
    return (
      <div className={`leading-[0.95] ${className}`}>
        <div className="text-4xl font-bold tracking-tight">
          <span className="text-white">Craf</span>
          <span className="text-mint">Cube</span>
        </div>
        <div className="mt-1 text-3xl font-light tracking-[0.18em] text-white">Nexus</div>
      </div>
    );
  }
  return (
    <span className={`font-semibold tracking-tight ${className}`}>
      <span className="text-white">Craf</span>
      <span className="text-mint">Cube</span>
      <span className="ml-1.5 font-light tracking-[0.14em] text-slate-300">Nexus</span>
    </span>
  );
}

/** Full lockup used on the auth screens. */
export function BrandLockup() {
  return (
    <div className="animate-fade-up">
      <div className="flex items-center gap-5">
        <LogoMark className="h-20 w-20" />
        <Wordmark stacked />
      </div>
      <div className="mt-7 rule" />
      <p className="mt-4 text-sm tracking-[0.2em] text-slate-400">
        3D ARTIFACT MANAGEMENT SYSTEM
      </p>
      <p className="mt-3 text-sm text-slate-500">
        Model <span className="mx-1.5 text-mint-600">·</span> Print
        <span className="mx-1.5 text-mint-600">·</span> Profit
      </p>
    </div>
  );
}
