/**
 * FIND ME icon set — one style everywhere: 24×24 grid, 2 px rounded strokes,
 * no fills except small accents. Original drawings.
 */
import type { JSX } from 'preact';

type P = { size?: number } & JSX.SVGAttributes<SVGSVGElement>;
const S = ({ size = 24, children, ...r }: P & { children: JSX.Element | JSX.Element[] }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" {...r}>
    {children}
  </svg>
);

export const Icon = {
  back: (p: P) => <S {...p}><path d="M15 5l-7 7 7 7" /></S>,
  brush: (p: P) => <S {...p}><path d="M14.5 4.5l5 5-8 8-5-5z" /><path d="M6.5 12.5c-2 .5-3 2-3 4.5 0 1 0 2.5-1 3 3 .5 6-.5 6.5-3" /></S>,
  drop: (p: P) => <S {...p}><path d="M12 3.5c3 4 6 7 6 10.5a6 6 0 0 1-12 0c0-3.5 3-6.5 6-10.5z" /><path d="M9.5 14.5a2.5 2.5 0 0 0 2.5 2.5" /></S>,
  bucket: (p: P) => <S {...p}><path d="M5 9l7-6 7 7-7 7z" /><path d="M5 9l-.5 5a2 2 0 0 0 3.5 1.5" /><path d="M19.5 15c1 1.5 1.5 2.5 1.5 3.5a1.5 1.5 0 0 1-3 0c0-1 .5-2 1.5-3.5z" /></S>,
  spray: (p: P) => <S {...p}><rect x="5" y="9" width="8" height="12" rx="2" /><path d="M7 9V6h4v3M9 6V4" /><path d="M16 5h.01M19 4h.01M18 7h.01M21 7h.01M16 9h.01M20 10h.01" /></S>,
  pattern: (p: P) => <S {...p}><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M4 10h16M4 15h16M10 4v16M15 4v16" /></S>,
  line: (p: P) => <S {...p}><path d="M5 19L19 5" /><circle cx="5" cy="19" r="1.5" /><circle cx="19" cy="5" r="1.5" /></S>,
  blur: (p: P) => <S {...p}><path d="M7 18a4 4 0 0 1-.5-8 5.5 5.5 0 0 1 10.5-1.5A4 4 0 0 1 17 18z" /></S>,
  eraser: (p: P) => <S {...p}><path d="M8 20h12" /><path d="M4.5 15.5l9-9a2 2 0 0 1 3 0l2 2a2 2 0 0 1 0 3l-8 8H8z" /><path d="M9 11l5 5" /></S>,
  camera: (p: P) => <S {...p}><path d="M4 8h3l1.5-2h7L17 8h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></S>,
  palette: (p: P) => <S {...p}><path d="M12 3a9 9 0 0 0 0 18c1.5 0 2-1 2-2s-1-1.5-1-2.5 1-1.5 2-1.5h2a4 4 0 0 0 4-4c0-4.5-4-8-9-8z" /><circle cx="7.5" cy="11" r="1" /><circle cx="10" cy="7" r="1" /><circle cx="15" cy="7.5" r="1" /></S>,
  pose: (p: P) => <S {...p}><circle cx="12" cy="5" r="2.5" /><path d="M5 10l7 1 7-1M12 11v4l-3 6M12 15l3 6" /></S>,
  lock: (p: P) => <S {...p}><rect x="5" y="11" width="14" height="10" rx="2.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></S>,
  unlock: (p: P) => <S {...p}><rect x="5" y="11" width="14" height="10" rx="2.5" /><path d="M8 11V8a4 4 0 0 1 7.5-2" /></S>,
  jump: (p: P) => <S {...p}><path d="M12 19V6M6 11l6-6 6 6" /></S>,
  crouch: (p: P) => <S {...p}><path d="M12 5v13M6 13l6 6 6-6" /></S>,
  undo: (p: P) => <S {...p}><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></S>,
  redo: (p: P) => <S {...p}><path d="M15 14l5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></S>,
  clear: (p: P) => <S {...p}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></S>,
  mirror: (p: P) => <S {...p}><path d="M12 3v18" stroke-dasharray="2 3" /><path d="M9 7L4 12l5 5zM15 7l5 5-5 5z" /></S>,
  target: (p: P) => <S {...p}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></S>,
  check: (p: P) => <S {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></S>,
  close: (p: P) => <S {...p}><path d="M6 6l12 12M18 6L6 18" /></S>,
  gear: (p: P) => <S {...p}><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M4.2 6.2l2.1 2.1M17.7 15.7l2.1 2.1M2.5 12h3M18.5 12h3M4.2 17.8l2.1-2.1M17.7 8.3l2.1-2.1" /></S>,
  play: (p: P) => <S {...p}><path d="M8 5v14l11-7z" /></S>,
  practice: (p: P) => <S {...p}><path d="M4 20l4-4M14.5 4.5l5 5-8.5 8.5-5-5z" /><circle cx="17" cy="7" r="1" /></S>,
  info: (p: P) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5h.01" /></S>,
  globe: (p: P) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" /></S>,
  chevron: (p: P) => <S {...p}><path d="M9 6l6 6-6 6" /></S>,
};
