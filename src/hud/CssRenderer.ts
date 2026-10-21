/**
 * A `Renderer` built from plain HTML elements instead of WebGL. Each model instance is one
 * absolutely positioned element (a CSS circle for Wisp's shapes), moved with `transform` and faded
 * with `opacity` — the two properties the browser's GPU compositor animates without repainting.
 *
 * Why not Three.js: Wisp is a handful of flat circles. Three.js was ~85% of the script and its
 * WebGL setup the heaviest work at startup; on the glasses' 500 Kbps link and slow CPU, that was
 * the whole startup cost. Gameplay is unchanged — it only ever talks to the `Renderer` interface.
 *
 * Setters only record state. `render()` writes the changed instances' styles in one batch, so a
 * frame never interleaves style writes with layout reads. Lives in `src/hud/` because it is DOM
 * output; the layer rules allow the DOM only here, in `main.ts` and in `log.ts`.
 */

import type { Vector3 } from '@/framework/math/Vector3';
import type { RenderHandle, RenderStats, Renderer } from '@/framework/render/Renderer';

/** How one model looks: a circle of `radius` world units, a fill color, and its stacking order. */
export interface CssModelSpec {
  radius: number;
  defaultColor: number;
  /** Stacking order; higher draws in front. */
  layer: number;
  /** Set for parts that animate often, so the browser keeps them on their own GPU layer. */
  animated?: boolean;
}

export type CssModelCatalog<TModelId extends string> = Record<TModelId, CssModelSpec>;

export interface CssRendererOptions {
  /** Half-height of the visible area in world units, as for the orthographic camera. */
  viewSize: number;
}

interface Instance {
  el: HTMLElement;
  /** Circle radius in px, for centering it on its position. */
  radiusPx: number;
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
  visible: boolean;
  dirty: boolean;
}

/** World units → stage pixels. Pure, so it is unit-tested without a DOM. */
export function worldToStage(
  x: number,
  y: number,
  stageSize: number,
  viewSize: number,
): { left: number; top: number } {
  const pxPerUnit = stageSize / (2 * viewSize);
  return { left: stageSize / 2 + x * pxPerUnit, top: stageSize / 2 - y * pxPerUnit };
}

export class CssRenderer<TModelId extends string> implements Renderer<TModelId> {
  private readonly instances = new Map<number, Instance>();
  private nextHandle = 1;
  private stageSize: number;
  private readonly viewSize: number;

  public constructor(
    private readonly world: HTMLElement,
    private readonly catalog: CssModelCatalog<TModelId>,
    options: CssRendererOptions,
  ) {
    this.viewSize = options.viewSize;
    this.stageSize = world.clientWidth || 600;
  }

  public addModel(modelId: TModelId, color?: number): RenderHandle {
    const spec = this.catalog[modelId];
    const radiusPx = spec.radius * this.pxPerUnit();
    const el = document.createElement('div');
    el.className = 'shape';
    el.style.width = `${radiusPx * 2}px`;
    el.style.height = `${radiusPx * 2}px`;
    el.style.background = `#${(color ?? spec.defaultColor).toString(16).padStart(6, '0')}`;
    el.style.zIndex = String(spec.layer);
    if (spec.animated) {
      el.style.willChange = 'transform, opacity';
    }
    this.world.appendChild(el);

    const handle = this.nextHandle++ as RenderHandle;
    this.instances.set(handle, {
      el,
      radiusPx,
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
      visible: true,
      dirty: true,
    });
    return handle;
  }

  public setTransform(handle: RenderHandle, position: Vector3): void {
    const inst = this.get(handle);
    if (inst.x !== position.x || inst.y !== position.y) {
      inst.x = position.x;
      inst.y = position.y;
      inst.dirty = true;
    }
  }

  public setRotation(handle: RenderHandle, radians: number): void {
    const inst = this.get(handle);
    if (inst.rotation !== radians) {
      inst.rotation = radians;
      inst.dirty = true;
    }
  }

  public setScale(handle: RenderHandle, scale: number | Vector3): void {
    const inst = this.get(handle);
    const sx = typeof scale === 'number' ? scale : scale.x;
    const sy = typeof scale === 'number' ? scale : scale.y;
    if (!Number.isFinite(sx) || !Number.isFinite(sy)) {
      throw new Error(`setScale: scale must be finite (got ${sx}, ${sy}).`);
    }
    if (inst.scaleX !== sx || inst.scaleY !== sy) {
      inst.scaleX = sx;
      inst.scaleY = sy;
      inst.dirty = true;
    }
  }

  public setOpacity(handle: RenderHandle, opacity: number): void {
    if (!Number.isFinite(opacity)) {
      throw new Error(`setOpacity: opacity must be a finite number 0..1 (got ${opacity}).`);
    }
    const inst = this.get(handle);
    const clamped = Math.min(Math.max(opacity, 0), 1);
    if (inst.opacity !== clamped) {
      inst.opacity = clamped;
      inst.dirty = true;
    }
  }

  public setFrame(): void {
    throw new Error('setFrame: CSS shapes have no spritesheet frames.');
  }

  public setVisible(handle: RenderHandle, visible: boolean): void {
    const inst = this.get(handle);
    if (inst.visible !== visible) {
      inst.visible = visible;
      inst.dirty = true;
    }
  }

  public remove(handle: RenderHandle): void {
    this.get(handle).el.remove();
    this.instances.delete(handle);
  }

  /** The stage is square (600x600), so only the width matters. */
  public resize(width: number, _height: number): void {
    this.stageSize = width;
  }

  /**
   * For the `?stats` overlay. There are no draw calls or triangles here; the closest equivalent is
   * how many shapes are on screen, reported as `drawCalls`.
   */
  public getStats(): RenderStats {
    let visible = 0;
    for (const inst of this.instances.values()) {
      if (inst.visible) {
        visible++;
      }
    }
    return { drawCalls: visible, triangles: 0, points: 0, lines: 0, geometries: 0, textures: 0 };
  }

  /** Write every changed instance's style, in one batch. */
  public render(): void {
    for (const inst of this.instances.values()) {
      if (!inst.dirty) {
        continue;
      }
      inst.dirty = false;
      const { el } = inst;
      el.style.display = inst.visible ? '' : 'none';
      if (!inst.visible) {
        continue;
      }
      const { left, top } = worldToStage(inst.x, inst.y, this.stageSize, this.viewSize);
      el.style.transform =
        `translate(${left - inst.radiusPx}px, ${top - inst.radiusPx}px) ` +
        `rotate(${-inst.rotation}rad) scale(${inst.scaleX}, ${inst.scaleY})`;
      el.style.opacity = String(inst.opacity);
    }
  }

  private pxPerUnit(): number {
    return this.stageSize / (2 * this.viewSize);
  }

  private get(handle: RenderHandle): Instance {
    const inst = this.instances.get(handle);
    if (!inst) {
      throw new Error(`CssRenderer: unknown handle ${handle}.`);
    }
    return inst;
  }
}
