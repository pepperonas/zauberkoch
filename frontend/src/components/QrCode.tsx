/** Renders a QR code as a self-contained SVG.
 *
 * One path for all dark modules (runs merged per row) rather than a rect per
 * module: a version-3 code is 841 modules, and ~250 path segments beat 400
 * DOM nodes for something that has to appear instantly.
 *
 * `shapeRendering="crispEdges"` matters more than it looks — antialiased
 * module edges are exactly the grey mush that makes a scanner hesitate.
 */

import { useMemo } from 'react';

import { qrPath } from '../lib/qr';

interface Props {
  text: string;
  /** Accessible name — the code itself carries no text for a screen reader. */
  label: string;
}

export function QrCode({ text, label }: Props) {
  // Encoding is pure and deterministic; re-running it on every parent render
  // would be silly, even at ~1ms.
  const { d, dim } = useMemo(() => qrPath(text), [text]);
  return (
    <svg
      className="qrcode"
      viewBox={`0 0 ${dim} ${dim}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      data-qr-size={dim}
    >
      {/* The light plate belongs to the picture, not to the surface behind it:
          a code drawn straight onto a dark dialog is unreadable, and the quiet
          zone is part of the spec, not decoration. */}
      <rect width={dim} height={dim} fill="#ffffff" />
      <path d={d} fill="#101410" />
    </svg>
  );
}
