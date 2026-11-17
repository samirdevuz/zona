import { CLASSES, CLASS_IDS, GADGETS, TEAM_COLORS, WEAPONS, type ClassId, type ItemId } from '@zona/shared';
import { t } from '../i18n';
import { h, setText, show } from './dom';
import type { Minimap, MinimapView } from './minimap';

export interface SpawnScreenState {
  phase: string;
  timeLeft: number;
  respawnT: number;
  ready: boolean;
  killerName: string;
  classId: ClassId;
  zone: number;
  spawnable: number[];
  team: number;
}

export interface SpawnCallbacks {
  selectClass(c: ClassId): void;
  selectZone(z: number): void;
  deploy(): void;
}

const MAP_PX = 340;

export function itemName(it: ItemId): string {
  return t(`item.${it}`);
}

/** Spawn screen: class cards with stats, top-down map with zones, deploy button (GAME.md 4.5, 10). */
export class SpawnScreen {
  readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly cards = new Map<ClassId, HTMLElement>();
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly zoneRow: HTMLElement;
  private readonly deployBtn: HTMLButtonElement;
  private minimap: Minimap | null = null;
  private lastZoneKey = '';
  private visible = false;

  constructor(parent: HTMLElement, private readonly cb: SpawnCallbacks) {
    this.title = h('div', { class: 'big' });
    this.sub = h('div', { class: 'small' });
    const cardRow = h('div', { class: 'class-cards' });
    CLASS_IDS.forEach((c, i) => {
      const card = h('button', { class: 'class-card', 'data-class': c });
      card.addEventListener('click', () => this.cb.selectClass(c));
      this.cards.set(c, card);
      cardRow.append(card);
      void i;
    });
    this.canvas = h('canvas', { width: String(MAP_PX), height: String(MAP_PX), class: 'spawn-map' });
    this.ctx = this.canvas.getContext('2d')!;
    this.canvas.addEventListener('click', (e) => this.onMapClick(e));
    this.zoneRow = h('div', { class: 'zone-row' });
    this.deployBtn = h('button', { class: 'primary deploy', 'data-testid': 'deploy' });
    this.deployBtn.addEventListener('click', () => this.cb.deploy());
    this.root = h(
      'div',
      { class: 'spawn-screen hidden interactive' },
      h('div', { class: 'spawn-head' }, this.title, this.sub),
      h('div', { class: 'spawn-body' }, cardRow, h('div', { class: 'spawn-right' }, this.canvas, this.zoneRow, this.deployBtn)),
      h('div', { class: 'small' }, t('spawn.keys')),
    );
    parent.append(this.root);
    this.renderCards();
  }

  setMinimap(m: Minimap | null): void {
    this.minimap = m;
    this.lastZoneKey = '';
  }

  isVisible(): boolean {
    return this.visible;
  }

  setVisible(on: boolean): void {
    if (on === this.visible) return;
    this.visible = on;
    show(this.root, on);
  }

  renderCards(): void {
    for (const [c, card] of this.cards) {
      const def = CLASSES[c];
      const gadgets = [def.slots[2], def.slots[3]].filter((x) => x !== 'none').map((x) => itemName(x));
      const w = WEAPONS[def.slots[0]];
      card.replaceChildren(
        h('div', { class: 'cls-name' }, `${CLASS_IDS.indexOf(c) + 1}. ${t(`class.${c}`)}`),
        h('div', { class: 'cls-role' }, t(`class.${c}.role`)),
        h('div', { class: 'cls-stats num' }, `HP ${def.hp} · ${t('spawn.speed')} ×${def.speedMult.toFixed(2)}`),
        h('div', { class: 'cls-weapon' }, `${itemName(def.slots[0])} — ${w.damageBody}/${w.damageHead}, ${w.rpm} RPM, ${w.magSize}/${w.reserveMax}`),
        h('div', { class: 'cls-gadgets' }, `${itemName('pistol')}${gadgets.length ? ' · ' + gadgets.join(' · ') : ''}${c === 'assault' ? ` ×${GADGETS.grenade.carried}` : ''}`),
      );
    }
  }

  update(s: SpawnScreenState, view: MinimapView): void {
    for (const [c, card] of this.cards) if (card.classList.contains('sel') !== (c === s.classId)) card.classList.toggle('sel', c === s.classId);
    if (s.phase === 'countdown') {
      setText(this.title, t('hud.countdown', { s: Math.ceil(s.timeLeft) }));
      setText(this.sub, t('spawn.choose'));
    } else {
      setText(this.title, s.killerName ? t('death.killedBy', { name: s.killerName }) : t('death.died'));
      setText(this.sub, s.spawnable.length === 0 ? t('death.noZone') : s.respawnT > 0 ? t('death.respawnIn', { s: Math.ceil(s.respawnT) }) : t('death.ready'));
    }
    const label = s.ready ? (s.respawnT > 0 || s.phase === 'countdown' ? t('spawn.waiting') : t('death.deploying')) : t('spawn.deploy');
    setText(this.deployBtn, label);
    this.deployBtn.classList.toggle('ready', s.ready);
    const key = `${s.spawnable.join(',')}|${s.zone}|${s.team}`;
    if (key !== this.lastZoneKey && this.minimap) {
      this.lastZoneKey = key;
      this.zoneRow.replaceChildren();
      for (const zi of s.spawnable) {
        const b = h('button', { class: 'zone-btn', style: `background:${TEAM_COLORS[s.team]}` }, String.fromCharCode(65 + zi));
        if (zi === s.zone) b.classList.add('sel');
        b.addEventListener('click', () => this.cb.selectZone(zi));
        this.zoneRow.append(b);
      }
    }
    if (this.minimap) this.minimap.draw(this.ctx, MAP_PX, view, null);
  }

  private onMapClick(e: MouseEvent): void {
    if (!this.minimap) return;
    const r = this.canvas.getBoundingClientRect();
    const w = this.minimap.pick(((e.clientX - r.left) / r.width) * MAP_PX, ((e.clientY - r.top) / r.height) * MAP_PX, MAP_PX);
    let best = -1;
    let bestD = 40 * 40;
    this.minimap.map.zones.forEach((z, i) => {
      const d = (z.x - w.x) ** 2 + (z.z - w.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best >= 0) this.cb.selectZone(best);
  }
}
