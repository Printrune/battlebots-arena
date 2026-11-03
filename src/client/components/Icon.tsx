import type { CSSProperties } from 'react';

type IconName = 'arrow' | 'plus' | 'link' | 'sound' | 'muted' | 'close' | 'check' | 'recover' | 'weapon' | 'exit' | 'rotate' | 'copy' | 'signal' | 'help';

export function Icon({ name, size = 20, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  const paths: Record<IconName, React.ReactNode> = {
    arrow: <><path d="M4 12h15M13 5l7 7-7 7" /></>,
    plus: <path d="M12 4v16M4 12h16" />,
    link: <><path d="m10 14 4-4M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0" transform="translate(1 0) scale(.9)" /></>,
    sound: <><path d="m4 9 4 0 5-4v14l-5-4H4zM17 8a6 6 0 0 1 0 8M20 5a10 10 0 0 1 0 14" /></>,
    muted: <><path d="m4 9 4 0 5-4v14l-5-4H4zM17 9l5 6M22 9l-5 6" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    check: <path d="m5 12 4 4L20 5" />,
    recover: <><path d="M5 8a8 8 0 1 1-1 8M5 3v6h6" /></>,
    weapon: <><path d="m14 2-9 12h7l-2 8 9-12h-7z" /></>,
    exit: <><path d="M10 4H4v16h6M10 12h11M17 8l4 4-4 4" /></>,
    rotate: <><rect x="7" y="2" width="10" height="20" rx="2" transform="rotate(35 12 12)" /><path d="M3 7V3h4M21 17v4h-4" /></>,
    copy: <><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M15 8V3H3v13h5" /></>,
    signal: <><path d="M4 19v-3M9 19v-7M14 19V8M19 19V4" /></>,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .6-1.5 1-1.5 2M12 17h.01" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>{paths[name]}</svg>;
}

export function BotSilhouette({ horizontal = false }: { horizontal?: boolean }) {
  return <svg className="bot-silhouette" viewBox="0 0 126 66" fill="none" aria-hidden="true">
    <ellipse cx="63" cy="57" rx="48" ry="6" fill="black" opacity=".3" />
    <path d="m27 24 39-10 36 13-39 15z" fill="#51575a" stroke="#92989a" strokeWidth="1.2" />
    <path d="m27 24 36 18v14L27 38z" fill="#282e31" stroke="#6e7476" />
    <path d="m63 42 39-15v15L63 56z" fill="#373e41" stroke="#737a7c" />
    <path d="m37 26 28-7 26 9-28 10z" fill="currentColor" opacity=".85" />
    <ellipse cx="32" cy="40" rx="8" ry="12" fill="#111415" stroke="#777f82" strokeWidth="2" />
    <ellipse cx="88" cy="48" rx="9" ry="11" fill="#111415" stroke="#777f82" strokeWidth="2" />
    {horizontal ? <><path d="m70 33 43 3-1 7-43-4z" fill="#cbd0cc" stroke="#fff" opacity=".8" /><circle cx="82" cy="37" r="5" fill="#333a3c" /></> : <><ellipse cx="80" cy="31" rx="5" ry="13" transform="rotate(28 80 31)" fill="#bcc2b7" stroke="currentColor" strokeWidth="3" /><path d="m29 25-8 4 9 5M39 22l-8 3 9 5" stroke="currentColor" strokeWidth="3" /></>}
  </svg>;
}
