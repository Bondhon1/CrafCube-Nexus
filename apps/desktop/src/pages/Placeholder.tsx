import { useLocation } from 'react-router-dom';
import { CURRENT_PHASE, NAVIGATION } from '@/app/navigation';

/** Renders any route the current phase has not implemented yet. */
export function Placeholder() {
  const { pathname } = useLocation();
  const item = NAVIGATION.flatMap((s) => s.children ?? []).find((c) => c.path === pathname);
  const phase = item?.phase ?? CURRENT_PHASE + 1;

  return (
    <div className="grid h-full place-items-center">
      <div className="card max-w-md text-center">
        <p className="font-mono text-xs uppercase tracking-widest text-slate-500">
          Phase {phase}
        </p>
        <h1 className="mt-2 text-lg font-semibold">{item?.label ?? 'Not built yet'}</h1>
        <p className="mt-2 text-sm text-slate-400">
          This screen is scheduled for phase {phase}. The route and navigation exist so the
          shell is complete; the feature lands when its phase does.
        </p>
      </div>
    </div>
  );
}
