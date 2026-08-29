/** Thumb geometry for the custom directional scrollbar (pure, unit-tested). */
export function scrollbarThumb(
  trackH: number,
  viewH: number,
  contentH: number,
  offset: number,
): { height: number; top: number } {
  if (contentH <= 0 || viewH <= 0 || trackH <= 0) return { height: 0, top: 0 };
  if (contentH <= viewH) return { height: trackH, top: 0 };
  const height = Math.max(26, Math.min(trackH, (viewH / contentH) * trackH));
  const range = trackH - height;
  const progress = Math.min(1, Math.max(0, offset / Math.max(1, contentH - viewH)));
  return { height, top: progress * range };
}
