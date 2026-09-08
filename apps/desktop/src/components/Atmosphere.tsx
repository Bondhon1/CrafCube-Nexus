import { LogoMark } from '@/components/Logo';

/**
 * Ambient background for the app shell.
 *
 * The sign-in screen sits on photography; the shell had nothing, so the two
 * halves of the product looked unrelated. This gives the shell the same depth
 * without decoration: two heavily blurred radial glows, a faint technical grid
 * that fades out downward, and a ghosted brand mark.
 *
 * Everything here is `pointer-events-none` and sits behind content. Opacities
 * are deliberately low — at these levels it reads as atmosphere rather than as
 * a graphic, which is the difference between industrial and gaming.
 */
export function Atmosphere() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {/* Radial glows: teal top-right, a cooler one bottom-left for balance. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 85% 4%, rgba(13,248,208,0.075), transparent 32%),' +
            'radial-gradient(circle at 12% 92%, rgba(0,150,255,0.035), transparent 30%)',
        }}
      />

      {/* Technical grid, masked so it never competes with content lower down. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(rgba(50,220,190,0.025) 1px, transparent 1px),' +
            'linear-gradient(90deg, rgba(50,220,190,0.025) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
          maskImage: 'linear-gradient(to bottom, black, transparent 78%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black, transparent 78%)',
        }}
      />

      {/* Ghosted mark. Bleeding off the right edge keeps it from reading as
          content the user is meant to look at. */}
      <div className="absolute -right-24 top-1/2 hidden -translate-y-1/2 opacity-[0.035] xl:block">
        <LogoMark className="h-[520px] w-[520px]" />
      </div>
    </div>
  );
}
