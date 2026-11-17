import { NEUTRAL_COLOR, TEAM_COLORS, type MapData, type Terrain } from '@zona/shared';
import type { ZoneView } from './hud';

const BASE = 256;

export interface MapDot {
  x: number;
  z: number;
  color: string;
}

export interface MinimapView {
  zones: ZoneView[];
  /** Local player (null when dead). */
  me: { x: number; z: number; yaw: number } | null;
  dots: MapDot[];
  selected: number;
  /** Zones that can be selected (spawn screen). */
  selectable: number[];
  time: number;
}

/**
 * Top-down map pre-rendered once per match from the heightfield, then drawn
 * with zone ownership, teammates and recently spotted enemies (GAME.md 10).
 */
export class Minimap {
  readonly base: HTMLCanvasElement;
  readonly half: number;

  constructor(readonly map: MapData, terrain: Terrain) {
    this.half = ((terrain.cols - 1) * terrain.cell) / 2;
    this.base = document.createElement('canvas');
    this.base.width = BASE;
    this.base.height = BASE;
    const ctx = this.base.getContext('2d')!;
    const img = ctx.createImageData(BASE, BASE);
    const g = { gx: 0, gz: 0 };
    for (let py = 0; py < BASE; py++) {
      for (let px = 0; px < BASE; px++) {
        const x = ((px + 0.5) / BASE) * 2 * this.half - this.half;
        const z = ((py + 0.5) / BASE) * 2 * this.half - this.half;
        const h = terrain.heightAt(x, z);
        terrain.gradientAt(x, z, g);
        const slope = Math.min(1, Math.sqrt(g.gx * g.gx + g.gz * g.gz));
        const shadeK = 0.78 + Math.max(-0.2, Math.min(0.25, (g.gx - g.gz) * -0.5));
        const t = Math.max(0, Math.min(1, (h + 4) / 26));
        let r = 70 + 60 * t;
        let gg = 110 + 40 * t;
        let b = 55 + 30 * t;
        r = r * (1 - slope) + 130 * slope;
        gg = gg * (1 - slope) + 125 * slope;
        b = b * (1 - slope) + 115 * slope;
        const o = (py * BASE + px) * 4;
        img.data[o] = r * shadeK;
        img.data[o + 1] = gg * shadeK;
        img.data[o + 2] = b * shadeK;
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const toPx = (v: number): number => ((v + this.half) / (2 * this.half)) * BASE;
    ctx.strokeStyle = 'rgba(214,190,140,0.9)';
    ctx.lineWidth = 2.2;
    for (const r of map.roads) {
      ctx.beginPath();
      ctx.moveTo(toPx(r.x0), toPx(r.z0));
      ctx.lineTo(toPx(r.x1), toPx(r.z1));
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(30,40,25,0.75)';
    for (const p of map.props) {
      const s = p.type === 'container' || p.type === 'bunker' || p.type === 'tower' ? 2.4 : 1.4;
      ctx.fillRect(toPx(p.x) - s / 2, toPx(p.z) - s / 2, s, s);
    }
    ctx.strokeStyle = 'rgba(255,80,80,0.6)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(BASE / 2, BASE / 2, (map.radius / (2 * this.half)) * BASE, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /** World (x, z) to base-canvas pixels. */
  toBase(v: number): number {
    return ((v + this.half) / (2 * this.half)) * BASE;
  }

  /**
   * Draw into ctx. `size` = output square size in px. `centre` null = whole map
   * north-up; otherwise a heading-up window of `radiusM` metres around the centre.
   */
  draw(ctx: CanvasRenderingContext2D, size: number, v: MinimapView, centre: { x: number; z: number; yaw: number; radiusM: number } | null): void {
    ctx.save();
    ctx.clearRect(0, 0, size, size);
    let scale: number; // px per base px
    if (centre) {
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      ctx.clip();
      scale = size / ((centre.radiusM * 2 * BASE) / (2 * this.half));
      ctx.translate(size / 2, size / 2);
      ctx.rotate(centre.yaw);
      ctx.scale(scale, scale);
      ctx.translate(-this.toBase(centre.x), -this.toBase(centre.z));
    } else {
      scale = size / BASE;
      ctx.scale(scale, scale);
    }
    ctx.drawImage(this.base, 0, 0);
    const k = 1 / scale;
    // Zones.
    this.map.zones.forEach((z, i) => {
      const st = v.zones[i];
      const x = this.toBase(z.x);
      const y = this.toBase(z.z);
      const owner = st ? st.owner : z.homeTeam;
      const r = Math.max(7 * k, (14 / (2 * this.half)) * BASE);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = owner >= 0 ? TEAM_COLORS[owner]! : NEUTRAL_COLOR;
      ctx.globalAlpha = st?.contested && Math.sin(v.time * 10) > 0 ? 0.45 : 0.95;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = (i === v.selected ? 3 : 1.2) * k;
      ctx.strokeStyle = i === v.selected ? '#ffffff' : v.selectable.includes(i) ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.6)';
      ctx.stroke();
      if (st?.contested) {
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2 * k;
        ctx.beginPath();
        ctx.arc(x, y, r + 3 * k, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.save();
      ctx.translate(x, y);
      if (centre) ctx.rotate(-centre.yaw);
      ctx.fillStyle = '#111';
      ctx.font = `bold ${10 * k}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(z.letter, 0, 0.5 * k);
      ctx.restore();
    });
    // Dots (teammates, spotted enemies).
    for (const d of v.dots) {
      ctx.beginPath();
      ctx.arc(this.toBase(d.x), this.toBase(d.z), 2.6 * k, 0, Math.PI * 2);
      ctx.fillStyle = d.color;
      ctx.fill();
      ctx.lineWidth = 0.8 * k;
      ctx.strokeStyle = '#000';
      ctx.stroke();
    }
    // Me (arrow pointing along yaw).
    if (v.me) {
      ctx.save();
      ctx.translate(this.toBase(v.me.x), this.toBase(v.me.z));
      ctx.rotate(-v.me.yaw);
      ctx.beginPath();
      ctx.moveTo(0, -6 * k);
      ctx.lineTo(4 * k, 4 * k);
      ctx.lineTo(0, 2 * k);
      ctx.lineTo(-4 * k, 4 * k);
      ctx.closePath();
      ctx.fillStyle = '#fde047';
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = k;
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  /** Inverse of the north-up full-map projection: canvas px -> world (x, z). */
  pick(px: number, py: number, size: number): { x: number; z: number } {
    return { x: (px / size) * 2 * this.half - this.half, z: (py / size) * 2 * this.half - this.half };
  }
}
