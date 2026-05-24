import { describe, it, expect } from "vite-plus/test";
import { computeDelay } from "#/web/components/ui/dot-loader";

describe("computeDelay", () => {
  it("wave-diagonal : délai proportionnel à row + col", () => {
    const step = 50;
    expect(computeDelay(0, 0, 5, 5, "wave-diagonal", 500, step)).toBe(0);
    expect(computeDelay(1, 2, 5, 5, "wave-diagonal", 500, step)).toBe(150);
    expect(computeDelay(4, 4, 5, 5, "wave-diagonal", 500, step)).toBe(400);
  });

  it("wave-diagonal-reverse : délai proportionnel à (rows-1-row) + col", () => {
    const step = 50;
    expect(computeDelay(4, 0, 5, 5, "wave-diagonal-reverse", 500, step)).toBe(0);
    expect(computeDelay(0, 0, 5, 5, "wave-diagonal-reverse", 500, step)).toBe(200);
    expect(computeDelay(0, 4, 5, 5, "wave-diagonal-reverse", 500, step)).toBe(400);
  });

  it("wave-horizontal : délai proportionnel à col uniquement", () => {
    const step = 50;
    expect(computeDelay(0, 0, 5, 5, "wave-horizontal", 500, step)).toBe(0);
    expect(computeDelay(3, 2, 5, 5, "wave-horizontal", 500, step)).toBe(100);
    expect(computeDelay(0, 4, 5, 5, "wave-horizontal", 500, step)).toBe(200);
  });

  it("wave-vertical : délai proportionnel à row uniquement", () => {
    const step = 50;
    expect(computeDelay(0, 3, 5, 5, "wave-vertical", 500, step)).toBe(0);
    expect(computeDelay(2, 0, 5, 5, "wave-vertical", 500, step)).toBe(100);
    expect(computeDelay(4, 0, 5, 5, "wave-vertical", 500, step)).toBe(200);
  });

  it("pulse : toujours 0 quelle que soit la position", () => {
    expect(computeDelay(0, 0, 5, 5, "pulse", 500, 50)).toBe(0);
    expect(computeDelay(3, 4, 5, 5, "pulse", 500, 50)).toBe(0);
    expect(computeDelay(2, 2, 5, 5, "pulse", 500, 50)).toBe(0);
  });

  it("ripple : distance depuis le centre", () => {
    const step = 50;
    const center = computeDelay(2, 2, 5, 5, "ripple", 500, step);
    expect(center).toBe(0);
    const corner = computeDelay(0, 0, 5, 5, "ripple", 500, step);
    expect(corner).toBeGreaterThan(0);
  });

  it("random : déterministe — même position donne toujours le même délai", () => {
    const d1 = computeDelay(2, 3, 5, 5, "random", 500, 50);
    const d2 = computeDelay(2, 3, 5, 5, "random", 500, 50);
    expect(d1).toBe(d2);
  });

  it("random : positions différentes donnent des délais différents", () => {
    const d1 = computeDelay(0, 0, 5, 5, "random", 500, 50);
    const d2 = computeDelay(1, 1, 5, 5, "random", 500, 50);
    expect(d1).not.toBe(d2);
  });

  it("scan-h : délai proportionnel à col/cols", () => {
    const duration = 500;
    expect(computeDelay(0, 0, 5, 5, "scan-h", duration, 50)).toBe(0);
    expect(computeDelay(3, 5, 5, 10, "scan-h", duration, 50)).toBe(250);
  });

  it("scan-v : délai proportionnel à row/rows", () => {
    const duration = 500;
    expect(computeDelay(0, 3, 5, 5, "scan-v", duration, 50)).toBe(0);
    expect(computeDelay(5, 0, 10, 5, "scan-v", duration, 50)).toBe(250);
  });

  it("fill : délai linéaire sur la grille", () => {
    const duration = 500;
    expect(computeDelay(0, 0, 5, 5, "fill", duration, 50)).toBe(0);
    expect(computeDelay(4, 4, 5, 5, "fill", duration, 50)).toBeCloseTo(duration * (24 / 25));
  });

  it("spinner : délai basé sur l'angle", () => {
    const duration = 500;
    const d1 = computeDelay(0, 2, 5, 5, "spinner", duration, 50);
    const d2 = computeDelay(2, 4, 5, 5, "spinner", duration, 50);
    expect(d1).not.toBe(d2);
    expect(d1).toBeGreaterThanOrEqual(0);
    expect(d1).toBeLessThanOrEqual(duration);
  });

  it("position (0,0) dans une grande grille", () => {
    expect(computeDelay(0, 0, 10, 10, "wave-diagonal", 1000, 100)).toBe(0);
  });
});
