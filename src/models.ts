/**
 * The game's model registry: the id union and how each model looks. Gameplay never sees this; it
 * refers to models by their `ModelId` and calls `renderer.addModel(id)`.
 *
 * Wisp is drawn with CSS circles by `src/hud/CssRenderer.ts` rather than Three.js (see that file
 * for why). Sizes are in world units, the same units gameplay positions things in. `layer` is the
 * stacking order: the halo sits behind the core, the eyes in front of it.
 */

import { COLORS } from '@/config/gameplayConstants';
import type { CssModelCatalog } from '@/hud/CssRenderer';

/** Identifies an in-code model. */
export type ModelId = 'core' | 'halo' | 'eye' | 'ringDot';

export const MODELS: CssModelCatalog<ModelId> = {
  halo: { radius: 1.1, defaultColor: COLORS.halo, layer: 0, animated: true },
  core: { radius: 0.6, defaultColor: COLORS.core, layer: 1, animated: true },
  // Pure black: see-through on the additive display, so the eyes read as holes in the light.
  eye: { radius: 0.09, defaultColor: COLORS.eye, layer: 2, animated: true },
  // The ring changes only when a dot lights, so its dots stay off dedicated GPU layers.
  ringDot: { radius: 0.07, defaultColor: COLORS.ring, layer: 1 },
};
