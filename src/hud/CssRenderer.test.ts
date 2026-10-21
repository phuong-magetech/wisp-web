/**
 * The world-to-stage mapping the CSS renderer places every shape with. It must match the old
 * orthographic camera exactly, or Wisp, its ring and the HUD layout would drift apart.
 */

import { describe, expect, it } from 'vitest';

import { DISPLAY, LAYOUT } from '@/config/gameplayConstants';
import { worldToStage } from '@/hud/CssRenderer';

const at = (x: number, y: number) => worldToStage(x, y, DISPLAY.width, LAYOUT.viewSize);

describe('worldToStage', () => {
  it('puts the world origin at the center of the 600x600 stage', () => {
    expect(at(0, 0)).toEqual({ left: 300, top: 300 });
  });

  it('maps the view edges to the stage edges, with world-up as screen-up', () => {
    expect(at(-LAYOUT.viewSize, LAYOUT.viewSize)).toEqual({ left: 0, top: 0 });
    expect(at(LAYOUT.viewSize, -LAYOUT.viewSize)).toEqual({ left: 600, top: 600 });
  });

  it("places Wisp's resting center where the HTML boot glow is drawn (300, 270)", () => {
    expect(at(0, LAYOUT.centerY)).toEqual({ left: 300, top: 270 });
  });
});
