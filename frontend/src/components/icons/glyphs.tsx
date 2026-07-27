/** Zauberkoch icon glyphs — Material-flat, 24×24 grid (ILLUSTRATION_STYLE.md).
 *
 * Functional glyphs are monochrome `currentColor` fills (secondary elements
 * use opacity 0.4–0.6 instead of extra colors); ring/arc forms may use a
 * 2px round stroke as a band shape — never as a contour outline.
 * Brand glyphs (logo, wand) carry 2–3 theme-token colors.
 * Universal symbols follow the Material Icons filled geometry; characterful
 * ones (wand, chef hat, pan, glasses, party …) are hand-drawn to match. */

import type { ReactElement } from 'react';

/** Four-point sparkle centered at (cx, cy) with radius r. */
function spark(cx: number, cy: number, r: number): string {
  const k = r * 0.18;
  return (
    `M${cx} ${cy - r}Q${cx + k} ${cy - k} ${cx + r} ${cy}` +
    `Q${cx + k} ${cy + k} ${cx} ${cy + r}Q${cx - k} ${cy + k} ${cx - r} ${cy}` +
    `Q${cx - k} ${cy - k} ${cx} ${cy - r}Z`
  );
}

const GOLD = 'var(--icon-gold, #f0b429)';

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

export const GLYPHS = {
  /* ---------- brand (2–3 colors, more character) ---------- */

  /** Kochmützen-Logo — hat in primary, band in tertiary, gold spark. */
  logo: (): ReactElement => (
    <>
      <g fill="var(--c-primary, currentColor)">
        <circle cx="7.6" cy="8.6" r="3.4" />
        <circle cx="12" cy="6.6" r="4" />
        <circle cx="16.4" cy="8.6" r="3.4" />
        <path d="M6 9.5h12v6.4H6Z" />
      </g>
      <rect x="6" y="17.2" width="12" height="2.9" rx="1.45" fill="var(--c-tertiary, currentColor)" />
      <path d={spark(21, 4, 2.2)} fill={GOLD} />
    </>
  ),

  /** Zauberstab — stick follows text color, gold sparkle tip. */
  wand: (): ReactElement => (
    <>
      <rect x="2.6" y="12.2" width="14.5" height="2.9" rx="1.45" transform="rotate(-45 9.9 13.6)" />
      <path d={spark(16.6, 7, 4)} fill={GOLD} />
      <path d={spark(21, 12.6, 1.8)} fill={GOLD} opacity="0.75" />
    </>
  ),

  /* ---------- magic & status ---------- */

  sparkles: (): ReactElement => (
    <>
      <path d={spark(10, 12.5, 7.5)} />
      <path d={spark(18.4, 5.6, 3.2)} opacity="0.6" />
      <path d={spark(18.2, 17.4, 2.5)} opacity="0.42" />
    </>
  ),
  warning: (): ReactElement => (
    <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
  ),
  check: (): ReactElement => <path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />,
  checkCircle: (): ReactElement => (
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
  ),
  close: (): ReactElement => (
    <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
  ),
  plus: (): ReactElement => <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z" />,
  ban: (): ReactElement => (
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM4 12c0-4.42 3.58-8 8-8 1.85 0 3.55.63 4.9 1.69L5.69 16.9C4.63 15.55 4 13.85 4 12zm8 8c-1.85 0-3.55-.63-4.9-1.69L18.31 7.1C19.37 8.45 20 10.15 20 12c0 4.42-3.58 8-8 8z" />
  ),
  snooze: (): ReactElement => (
    <>
      <path d="M17.6 14.5A7.6 7.6 0 1 1 8.3 4.6a6.2 6.2 0 0 0 9.3 9.9Z" />
      <path d={spark(17.4, 5.6, 2.6)} opacity="0.7" />
      <path d={spark(21, 10.4, 1.6)} opacity="0.5" />
    </>
  ),
  party: (): ReactElement => (
    <>
      <path d="M3.1 20.9 8.2 8.6l7.2 7.2L3.1 20.9Z" />
      <path d="M14.6 8.6c2.6-.9 4.6.1 5.1 2.6" {...STROKE} strokeWidth="1.8" />
      <path d={spark(15.6, 4.4, 2.2)} />
      <circle cx="20.2" cy="6.6" r="1.3" opacity="0.7" />
      <circle cx="19" cy="14.8" r="1.2" opacity="0.55" />
      <circle cx="11.6" cy="3.6" r="1.1" opacity="0.55" />
    </>
  ),
  /** Offline — wifi fan (fading arcs) struck through. */
  wifiOff: (): ReactElement => (
    <>
      <g {...STROKE}>
        <path d="M3.8 10.6A11 11 0 0 1 20.2 10.6" opacity="0.45" />
        <path d="M6.9 13.5A7 7 0 0 1 17.1 13.5" opacity="0.7" />
        <path d="M9.7 16.1A3.2 3.2 0 0 1 14.3 16.1" />
        <path d="M3.6 3.6 20.4 20.4" />
      </g>
      <circle cx="12" cy="18.3" r="1.4" />
    </>
  ),

  /* ---------- navigation & shell ---------- */

  calendar: (): ReactElement => (
    <path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V3h-2V1h-2zm3 18H5V8h14v11z" />
  ),
  star: (): ReactElement => (
    <path d="M12 2.6l2.9 5.9 6.5 1-4.7 4.6 1.1 6.5-5.8-3.1-5.8 3.1 1.1-6.5-4.7-4.6 6.5-1L12 2.6Z" />
  ),
  starOff: (): ReactElement => (
    <path
      d="M12 3.8l2.5 5.1 5.7.9-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.9L12 3.8Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    />
  ),
  history: (): ReactElement => (
    <path d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z" />
  ),
  cart: (): ReactElement => (
    <path d="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49A1.003 1.003 0 0 0 20 4H5.21l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z" />
  ),
  sun: (): ReactElement => (
    <>
      <circle cx="12" cy="12" r="4.6" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
        <rect key={a} x="11" y="1.8" width="2" height="3.6" rx="1" transform={`rotate(${a} 12 12)`} />
      ))}
    </>
  ),
  moon: (): ReactElement => (
    <path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.39 5.39 0 0 1-4.4 2.26 5.4 5.4 0 0 1-5.4-5.4c0-1.81.9-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z" />
  ),
  shield: (): ReactElement => (
    <path
      fillRule="evenodd"
      d="M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4Zm-1.9 15.2-3.3-3.3 1.4-1.4 1.9 1.9 4.7-4.7 1.4 1.4-6.1 6.1Z"
    />
  ),
  user: (): ReactElement => (
    <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
  ),
  power: (): ReactElement => (
    <path d="M13 3h-2v10h2V3zm4.83 2.17-1.42 1.42A6.92 6.92 0 0 1 19 12c0 3.87-3.13 7-7 7A6.995 6.995 0 0 1 7.58 6.58L6.17 5.17A8.932 8.932 0 0 0 3 12a9 9 0 0 0 18 0c0-2.74-1.23-5.18-3.17-6.83z" />
  ),

  /* ---------- actions ---------- */

  share: (): ReactElement => (
    <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z" />
  ),
  print: (): ReactElement => (
    <>
      <path d="M7 9V4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v5h-2V5H9v4H7z" />
      <path d="M5 10a2 2 0 0 0-2 2v5a1 1 0 0 0 1 1h2v-2H5v-4h14v4h-1v2h2a1 1 0 0 0 1-1v-5a2 2 0 0 0-2-2H5z" />
      <path d="M8 14h8a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1zm1 2v3h6v-3H9z" opacity=".55" />
    </>
  ),
  download: (): ReactElement => (
    <>
      <path d="M12 3a1 1 0 0 1 1 1v8.59l2.3-2.3a1 1 0 0 1 1.4 1.42l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.42l2.3 2.3V4a1 1 0 0 1 1-1z" />
      <path d="M4 18a1 1 0 0 1 1 1v.5h14V19a1 1 0 1 1 2 0v1a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 20v-1a1 1 0 0 1 1-1z" opacity=".55" />
    </>
  ),
  copy: (): ReactElement => (
    <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
  ),
  link: (): ReactElement => (
    <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z" />
  ),
  edit: (): ReactElement => (
    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.87-1.83z" />
  ),
  settings: (): ReactElement => (
    <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
  ),
  camera: (): ReactElement => (
    <path
      fillRule="evenodd"
      d="M9 2 7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-2a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"
    />
  ),
  trash: (): ReactElement => (
    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
  ),
  broom: (): ReactElement => (
    <path d="M16 11h-1V3c0-1.1-.9-2-2-2h-2c-1.1 0-2 .9-2 2v8H8c-2.76 0-5 2.24-5 5v7h18v-7c0-2.76-2.24-5-5-5zm3 10h-2v-3c0-.55-.45-1-1-1s-1 .45-1 1v3h-2v-3c0-.55-.45-1-1-1s-1 .45-1 1v3H9v-3c0-.55-.45-1-1-1s-1 .45-1 1v3H5v-5c0-1.65 1.35-3 3-3h8c1.65 0 3 1.35 3 3v5z" />
  ),
  mic: (): ReactElement => (
    <>
      <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
      <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
    </>
  ),
  dice: (): ReactElement => (
    <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM7.5 18c-.83 0-1.5-.67-1.5-1.5S6.67 15 7.5 15s1.5.67 1.5 1.5S8.33 18 7.5 18zm0-9C6.67 9 6 8.33 6 7.5S6.67 6 7.5 6 9 6.67 9 7.5 8.33 9 7.5 9zm4.5 4.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM16.5 18c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm0-9c-.83 0-1.5-.67-1.5-1.5S15.67 6 16.5 6s1.5.67 1.5 1.5S17.33 9 16.5 9z" />
  ),
  gift: (): ReactElement => (
    <path d="M20 6h-2.18c.11-.31.18-.65.18-1 0-1.66-1.34-3-3-3-1.05 0-1.96.54-2.5 1.35l-.5.67-.5-.68C10.96 2.54 10.05 2 9 2 7.34 2 6 3.34 6 5c0 .35.07.69.18 1H4c-1.11 0-1.99.89-1.99 2L2 19c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-5-2c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zM9 4c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm11 15H4v-2h16v2zm0-5H4V8h5.08L7 10.83 8.62 12 11 8.76l1-1.36 1 1.36L15.38 12 17 10.83 14.92 8H20v6z" />
  ),
  ticket: (): ReactElement => (
    <path d="M20 12c0-1.1.9-2 2-2V6c0-1.1-.9-2-2-2H4c-1.1 0-1.99.9-1.99 2v4c1.1 0 1.99.9 1.99 2s-.89 2-2 2v4c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2v-4c-1.1 0-2-.9-2-2zm-4.42 4.8L12 14.5l-3.58 2.3 1.08-4.12-3.29-2.69 4.24-.25L12 5.8l1.54 3.95 4.24.25-3.29 2.69 1.08 4.11z" />
  ),
  heart: (): ReactElement => (
    <path d="M12 21l-1.45-1.32C5.4 14.99 2 11.9 2 8.14 2 5.05 4.42 2.63 7.5 2.63c1.74 0 3.41.81 4.5 2.09 1.09-1.28 2.76-2.09 4.5-2.09C19.58 2.63 22 5.05 22 8.14c0 3.76-3.4 6.85-8.55 11.55L12 21z" />
  ),
  mail: (): ReactElement => (
    <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z" />
  ),
  tools: (): ReactElement => (
    <path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z" />
  ),
  thumbUp: (): ReactElement => (
    <path d="M1 21h4V9H1v12zM23 10c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.58 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z" />
  ),
  thumbDown: (): ReactElement => (
    <path d="M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z" />
  ),
  image: (): ReactElement => (
    <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" />
  ),
  note: (): ReactElement => (
    <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
  ),

  /* ---------- kitchen & bar ---------- */

  chefhat: (): ReactElement => (
    <>
      <circle cx="7.6" cy="8.8" r="3.3" />
      <circle cx="12" cy="6.8" r="3.9" />
      <circle cx="16.4" cy="8.8" r="3.3" />
      <path d="M6.2 9.5h11.6v6.4H6.2Z" />
      <rect x="6.2" y="17.3" width="11.6" height="2.7" rx="1.35" opacity="0.55" />
    </>
  ),
  pan: (): ReactElement => (
    <>
      <path d="M2.5 10.5h13a5 5 0 0 1-5 5h-3a5 5 0 0 1-5-5Z" />
      <rect x="15" y="9.6" width="6.6" height="1.9" rx="0.95" />
      <path d="M6.6 3.6c.9 1.1.9 2.2 0 3.3" {...STROKE} strokeWidth="1.7" opacity="0.55" />
      <path d="M10.6 3.6c.9 1.1.9 2.2 0 3.3" {...STROKE} strokeWidth="1.7" opacity="0.55" />
    </>
  ),
  cocktail: (): ReactElement => (
    <path d="M21 5V3H3v2l8 9v5H6v2h12v-2h-5v-5l8-9zM7.43 7 5.66 5h12.69l-1.78 2H7.43z" />
  ),
  glass: (): ReactElement => (
    <>
      <path
        d="M5.5 3.5h13l-1.1 15.4a2 2 0 0 1-2 1.6H8.6a2 2 0 0 1-2-1.6L5.5 3.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M7.1 12h9.8l-.5 6.3a1 1 0 0 1-1 .9H8.6a1 1 0 0 1-1-.9L7.1 12Z" opacity="0.55" />
    </>
  ),
  plate: (): ReactElement => (
    <path d="M8.1 13.34l2.83-2.83L3.91 3.5c-1.56 1.56-1.56 4.09 0 5.66l4.19 4.18zm6.78-1.81c1.53.71 3.68.21 5.27-1.38 1.91-1.91 2.28-4.65.81-6.12-1.46-1.46-4.2-1.1-6.12.81-1.59 1.59-2.09 3.74-1.38 5.27L3.7 19.87l1.41 1.41L12 14.41l6.88 6.88 1.41-1.41L13.41 13l1.47-1.47z" />
  ),
  herb: (): ReactElement => (
    <path d="M6.05 8.05c-2.73 2.73-2.73 7.15-.02 9.88 1.47-3.4 4.09-6.24 7.36-7.93-2.77 2.34-4.71 5.61-5.39 9.32 2.6 1.23 5.8.78 7.95-1.37C19.43 14.47 20 4 20 4S9.53 4.57 6.05 8.05z" />
  ),
  bulb: (): ReactElement => (
    <path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z" />
  ),

  /* ---------- meta stats ---------- */

  clock: (): ReactElement => (
    <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z" />
  ),
  timer: (): ReactElement => (
    <path d="M15 1H9v2h6V1zm-4 13h2V8h-2v6zm8.03-6.61 1.42-1.42c-.43-.51-.9-.99-1.41-1.41l-1.42 1.42A8.962 8.962 0 0 0 12 4c-4.97 0-9 4.03-9 9s4.02 9 9 9 9-4.03 9-9c0-2.12-.74-4.07-1.97-5.61zM12 20c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z" />
  ),
  gauge: (): ReactElement => (
    <>
      <rect x="4" y="13.6" width="4.2" height="6.4" rx="1.2" />
      <rect x="9.9" y="9.4" width="4.2" height="10.6" rx="1.2" opacity="0.65" />
      <rect x="15.8" y="4.4" width="4.2" height="15.6" rx="1.2" opacity="0.35" />
    </>
  ),

  /* ---------- regions (cuisine catalog headers) ---------- */

  globe: (): ReactElement => (
    <>
      <circle cx="12" cy="12" r="8.6" {...STROKE} />
      <ellipse cx="12" cy="12" rx="4" ry="8.6" {...STROKE} strokeWidth="1.7" />
      <path d="M3.6 12h16.8" {...STROKE} strokeWidth="1.7" />
    </>
  ),
  landmark: (): ReactElement => (
    <>
      <path d="M12 2.6 20.5 7v2H3.5V7L12 2.6Z" />
      <rect x="4.5" y="10.4" width="2" height="6.4" rx="0.6" />
      <rect x="8.8" y="10.4" width="2" height="6.4" rx="0.6" />
      <rect x="13.2" y="10.4" width="2" height="6.4" rx="0.6" />
      <rect x="17.5" y="10.4" width="2" height="6.4" rx="0.6" />
      <rect x="3.5" y="18.2" width="17" height="2.4" rx="1.2" />
    </>
  ),
  dome: (): ReactElement => (
    <>
      <path d="M12 2.4c3.6 2.3 5.6 5 5.6 7.9H6.4c0-2.9 2-5.6 5.6-7.9Z" />
      <circle cx="12" cy="1.8" r="0.9" />
      <rect x="5.6" y="11.6" width="12.8" height="3" rx="1.2" />
      <rect x="2.6" y="8.6" width="2.2" height="6" rx="1.1" opacity="0.6" />
      <rect x="19.2" y="8.6" width="2.2" height="6" rx="1.1" opacity="0.6" />
      <rect x="4" y="16" width="16" height="4.6" rx="1.4" opacity="0.4" />
    </>
  ),
  compass: (): ReactElement => (
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm2.19 12.19L6 18l3.81-8.19L18 6l-3.81 8.19zM12 10.9c-.61 0-1.1.49-1.1 1.1s.49 1.1 1.1 1.1 1.1-.49 1.1-1.1-.49-1.1-1.1-1.1z" />
  ),
} as const;

export type IconName = keyof typeof GLYPHS;
