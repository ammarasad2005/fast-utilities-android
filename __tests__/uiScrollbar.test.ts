import { scrollbarThumb } from '@/core/scrollbar';

describe('scrollbarThumb (directional rail geometry)', () => {
  test('content fits viewport → full-track thumb at top (rail usually hidden anyway)', () => {
    expect(scrollbarThumb(300, 400, 350, 0)).toEqual({ height: 300, top: 0 });
  });

  test('start of long content → proportional thumb at top', () => {
    const t = scrollbarThumb(300, 200, 1000, 0);
    expect(t.top).toBe(0);
    // viewH/contentH = 0.2 → 60, above the 26 floor
    expect(t.height).toBeCloseTo(60, 5);
  });

  test('end of content → thumb pinned to track bottom', () => {
    const t = scrollbarThumb(300, 200, 1000, 800); // offset == max scroll
    expect(t.top + t.height).toBeCloseTo(300, 5);
  });

  test('mid scroll → mid thumb', () => {
    const t = scrollbarThumb(300, 200, 1000, 400); // 50% progress
    // track 300, thumb 60 → range 240 → 50% = 120
    expect(t.top).toBeCloseTo(120, 5);
  });

  test('tiny viewport fractions clamp to the 26px floor', () => {
    const t = scrollbarThumb(100, 50, 100000, 0);
    expect(t.height).toBe(26);
  });

  test('degenerate inputs never break layout', () => {
    expect(scrollbarThumb(0, 200, 1000, 0)).toEqual({ height: 0, top: 0 });
    expect(scrollbarThumb(300, 0, 1000, 0)).toEqual({ height: 0, top: 0 });
  });
});
