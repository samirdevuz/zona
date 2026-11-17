import { NEUTRAL_COLOR, TEAM_COLORS, TEAM_NAME_KEYS, WEAPONS, WEAPON_IDS, ZONES, type ActorInfo, type BoardRow, type ItemId } from '@zona/shared';
import { t } from '../i18n';
import { fmtTime, h, setStyle, setText, show } from './dom';

export interface ZoneView {
  owner: number;
  contested: boolean;
  control: number[];
}

/** Data the game writes every frame; reused, never reallocated. */
export interface HudFrame {
  phase: string;
  timeLeft: number;
  scores: number[];
  zones: ZoneView[];
  myTeam: number;
  alive: boolean;
  hp: number;
  maxHp: number;
  ammo: number;
  reserve: number;
  reloadT: number;
  protectT: number;
  oobT: number;
  respawnT: number;
  sprinting: boolean;
  ads: boolean;
  spreadPx: number;
  /** Zone the player stands in (-1 none). */
  inZone: number;
  spawnZone: number;
  spawnable: number[];
  killerName: string;
  showBoard: boolean;
  showMap: boolean;
  /** Items in the four slots, the selected slot and per-slot magazine/reserve. */
  items: ItemId[];
  slot: number;
  mags: number[];
  res: number[];
  gadgetCd: number;
  /** Looking through a scope. */
  scoped: boolean;
  /** Total control: team holding every zone (-1 none) and seconds held. */
  tcTeam: number;
  tcSeconds: number;
  /** My team owns no zone. */
  noZones: boolean;
  /** Driving a vehicle (hide infantry ammo/crosshair) / looking through the tank sight. */
  driving: boolean;
  tankSight: boolean;
}

const teamColor = (t: number): string => (t >= 0 ? TEAM_COLORS[t]! : NEUTRAL_COLOR);
const teamName = (team: number): string => t(TEAM_NAME_KEYS[team] ?? 'team.blue');
const OOB_GRACE = 8;
/** Big map canvas size in pixels (scaled down by CSS on small screens). */
export const BIG_MAP_PX = 560;

/** In-game HUD (GAME.md 10). DOM is only touched when values change. */
export class Hud {
  readonly root: HTMLElement;
  private readonly crosshair: HTMLElement;
  private readonly chParts: HTMLElement[];
  private readonly hitmarker: HTMLElement;
  private hitT = 0;
  private readonly scoreEls: HTMLElement[] = [];
  private readonly zonePips: { el: HTMLElement; ring: HTMLElement }[] = [];
  private readonly strip: HTMLElement;
  private readonly zonesStrip: HTMLElement;
  private readonly timer: HTMLElement;
  private readonly capture: HTMLElement;
  private readonly captureText: HTMLElement;
  private readonly captureFill: HTMLElement;
  private readonly health: HTMLElement;
  private readonly hpVal: HTMLElement;
  private readonly hpFill: HTMLElement;
  private readonly protect: HTMLElement;
  private readonly ammo: HTMLElement;
  private readonly mag: HTMLElement;
  private readonly reserve: HTMLElement;
  private readonly ammoHint: HTMLElement;
  private readonly killfeed: HTMLElement;
  private readonly announceEl: HTMLElement;
  private announceT = 0;
  private readonly center: HTMLElement;
  private readonly centerMain: HTMLElement;
  private readonly centerSub: HTMLElement;
  private readonly vignette: HTMLElement;
  private vignetteT = 0;
  private readonly dmgDirs: HTMLElement[] = [];
  private nextDmg = 0;
  private readonly death: HTMLElement;
  private readonly deathTitle: HTMLElement;
  private readonly deathSub: HTMLElement;
  private readonly deathZones: HTMLElement;
  private readonly board: HTMLElement;
  private readonly stats: HTMLElement;
  private readonly toastEl: HTMLElement;
  private toastT = 0;
  readonly markers: HTMLElement;
  private readonly banner: HTMLElement;
  private zoneCount = 0;
  private lastSlotKey = '';
  private readonly slotsEl: HTMLElement;
  private readonly weaponName: HTMLElement;
  private readonly scope: HTMLElement;
  private readonly tcEl: HTMLElement;
  private readonly warnEl: HTMLElement;
  readonly minimapCanvas: HTMLCanvasElement;
  /** Full-map overlay while the map key is held (GAME.md 8.1). */
  readonly bigMapCanvas: HTMLCanvasElement;
  private readonly prompt: HTMLElement;
  private readonly promptText: HTMLElement;
  private readonly promptFill: HTMLElement;
  private readonly vpanel: HTMLElement;
  private readonly vname: HTMLElement;
  private readonly vhpFill: HTMLElement;
  private readonly vinfo: HTMLElement;
  private readonly aimMarker: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = h('div', { class: 'hud hidden' });
    this.markers = h('div', { class: 'markers' });
    this.vignette = h('div', { class: 'vignette' });
    const dmg = h('div', { class: 'dmg-dir' });
    for (let i = 0; i < 4; i++) {
      const e = h('i');
      this.dmgDirs.push(e);
      dmg.append(e);
    }
    this.chParts = ['l', 'r', 't', 'b', 'dot'].map((c) => h('i', { class: c }));
    this.crosshair = h('div', { class: 'crosshair' }, ...this.chParts);
    this.hitmarker = h('div', { class: 'hitmarker' });
    for (let i = 0; i < 4; i++) this.hitmarker.append(h('i', { style: `transform: rotate(${45 + i * 90}deg)` }));
    this.zonesStrip = h('div', { class: 'zones-strip' });
    this.strip = h('div', { class: 'top-strip' });
    this.timer = h('div', { class: 'timer num' });
    this.captureText = h('div');
    this.captureFill = h('div', { class: 'fill' });
    this.capture = h('div', { class: 'capture-bar hidden' }, this.captureText, h('div', { class: 'bar' }, this.captureFill));
    this.hpVal = h('div', { class: 'val num' });
    this.hpFill = h('div', { class: 'fill' });
    this.protect = h('div', { class: 'protect hidden' }, t('hud.protect'));
    this.health = h('div', { class: 'health' }, this.protect, this.hpVal, h('div', { class: 'bar' }, this.hpFill));
    this.mag = h('span', { class: 'mag num' });
    this.reserve = h('span', { class: 'reserve num' });
    this.ammoHint = h('div', { class: 'hint' });
    this.weaponName = h('div', { class: 'weapon' });
    this.slotsEl = h('div', { class: 'slots' });
    this.ammo = h('div', { class: 'ammo' }, this.ammoHint, h('div', {}, this.mag, h('span', { class: 'reserve sep' }, ' / '), this.reserve), this.weaponName, this.slotsEl);
    this.scope = h('div', { class: 'scope hidden' }, h('i', { class: 'h' }), h('i', { class: 'v' }));
    this.tcEl = h('div', { class: 'tc-line' });
    this.warnEl = h('div', { class: 'warn-line' });
    this.minimapCanvas = h('canvas', { class: 'minimap', width: '180', height: '180' });
    this.bigMapCanvas = h('canvas', { class: 'bigmap hidden', width: String(BIG_MAP_PX), height: String(BIG_MAP_PX) });
    this.promptText = h('div');
    this.promptFill = h('div', { class: 'fill' });
    this.prompt = h('div', { class: 'prompt hidden' }, this.promptText, h('div', { class: 'bar' }, this.promptFill));
    this.vname = h('div', { class: 'vname' });
    this.vhpFill = h('div', { class: 'fill' });
    this.vinfo = h('div', { class: 'vinfo num' });
    this.vpanel = h('div', { class: 'vpanel hidden' }, this.vname, h('div', { class: 'bar' }, this.vhpFill), this.vinfo);
    this.aimMarker = h('div', { class: 'aim-marker hidden' });
    this.killfeed = h('div', { class: 'killfeed' });
    this.announceEl = h('div', { class: 'announce' });
    this.centerMain = h('div');
    this.centerSub = h('div', { class: 'sub' });
    this.center = h('div', { class: 'center-msg hidden' }, this.centerMain, this.centerSub);
    this.deathTitle = h('div', { class: 'big' });
    this.deathSub = h('div');
    this.deathZones = h('div', { class: 'zones' });
    this.death = h('div', { class: 'death hidden' }, this.deathTitle, this.deathSub, this.deathZones);
    this.board = h('div', { class: 'scoreboard hidden' });
    this.stats = h('div', { class: 'stats hidden' });
    this.toastEl = h('div', { class: 'toast hidden' });
    this.banner = h('div', { class: 'banner hidden' });
    this.root.append(this.scope, this.minimapCanvas, this.bigMapCanvas, this.prompt, this.vpanel, this.aimMarker, this.tcEl, this.warnEl, this.markers, this.vignette, dmg, this.crosshair, this.hitmarker, this.strip, this.timer, this.capture, this.health, this.ammo, this.killfeed, this.announceEl, this.center, this.death, this.board, this.stats, this.toastEl, this.banner);
    parent.append(this.root);
  }

  setVisible(on: boolean): void {
    show(this.root, on);
  }

  /** Build the score/zone strip for a match. */
  setupMatch(teams: number, zoneLetters: string[]): void {
    this.strip.replaceChildren();
    this.scoreEls.length = 0;
    this.zonePips.length = 0;
    this.zonesStrip.replaceChildren();
    for (const letter of zoneLetters) {
      const ring = h('div', { class: 'ring' });
      const el = h('div', { class: 'zone-pip' }, ring, letter);
      this.zonePips.push({ el, ring });
      this.zonesStrip.append(el);
    }
    for (let i = 0; i < teams; i++) {
      const s = h('div', { class: 'team-score num', style: `color:${TEAM_COLORS[i]}` }, '0');
      this.scoreEls.push(s);
    }
    // Team 0 left of the zones, the rest to the right.
    this.strip.append(this.scoreEls[0]!, this.zonesStrip, ...this.scoreEls.slice(1));
    this.zoneCount = zoneLetters.length;
    this.killfeed.replaceChildren();
    show(this.banner, false);
    this.lastSlotKey = '';
  }

  update(f: HudFrame, dt: number): void {
    // Scores and zones.
    for (let i = 0; i < this.scoreEls.length; i++) setText(this.scoreEls[i]!, String(Math.floor(f.scores[i] ?? 0)));
    for (let i = 0; i < this.zoneCount; i++) {
      const z = f.zones[i];
      const pip = this.zonePips[i];
      if (!z || !pip) continue;
      setStyle(pip.el, 'background', teamColor(z.owner));
      let lead = z.owner;
      let prog = z.owner >= 0 ? z.control[z.owner]! : 0;
      if (z.owner < 0) {
        for (let k = 0; k < z.control.length; k++) {
          if (z.control[k]! > prog) {
            prog = z.control[k]!;
            lead = k;
          }
        }
      }
      const ringBg = prog > 0 && prog < 100 ? `conic-gradient(${teamColor(lead)} ${prog}%, rgba(0,0,0,0.35) 0)` : 'none';
      setStyle(pip.ring, 'background', ringBg);
      const c = z.contested;
      if (pip.el.classList.contains('contested') !== c) pip.el.classList.toggle('contested', c);
    }
    setText(this.timer, f.phase === 'live' ? fmtTime(f.timeLeft) : '');

    // Center messages: countdown / out of bounds.
    let centerMain = '';
    const centerSub = '';
    if (f.phase === 'countdown' && f.alive) centerMain = t('hud.countdown', { s: Math.ceil(f.timeLeft) });
    else if (f.alive && f.oobT > 0) {
      centerMain = t('hud.oob', { s: Math.max(0, Math.ceil(OOB_GRACE - f.oobT)) });
    }
    show(this.center, centerMain !== '');
    setText(this.centerMain, centerMain);
    setText(this.centerSub, centerSub);
    if (this.center.classList.contains('oob') !== (f.oobT > 0)) this.center.classList.toggle('oob', f.oobT > 0);

    // Health / ammo.
    show(this.health, f.alive);
    show(this.ammo, f.alive && !f.driving);
    setText(this.hpVal, String(Math.max(0, Math.ceil(f.hp))));
    setStyle(this.hpFill, 'width', `${Math.max(0, Math.min(100, (f.hp / f.maxHp) * 100)).toFixed(0)}%`);
    const low = f.hp < f.maxHp * 0.35;
    if (this.health.classList.contains('low') !== low) this.health.classList.toggle('low', low);
    show(this.protect, f.protectT > 0);
    const item = f.items[f.slot] ?? 'none';
    const gun = item in WEAPONS;
    const sep = this.ammo.querySelector('.sep') as HTMLElement;
    if (gun) {
      setText(this.mag, String(f.mags[f.slot] ?? 0));
      setText(this.reserve, String(f.res[f.slot] ?? 0));
      show(sep, true);
      const mag = f.mags[f.slot] ?? 0;
      const res = f.res[f.slot] ?? 0;
      const low = mag <= Math.max(1, Math.floor(WEAPONS[item as keyof typeof WEAPONS].magSize / 4));
      setText(this.ammoHint, f.reloadT > 0 ? t('hud.reloading') : mag === 0 && res === 0 ? t('hud.noAmmo') : low ? t('hud.reload') : '');
    } else {
      show(sep, false);
      setText(this.reserve, '');
      if (item === 'grenade') setText(this.mag, `×${f.mags[f.slot] ?? 0}`);
      else setText(this.mag, '');
      setText(this.ammoHint, item === 'medpack' || item === 'ammobox' ? (f.gadgetCd > 0 ? t('hud.cooldown', { s: Math.ceil(f.gadgetCd) }) : t('hud.ready')) : item === 'torch' ? t('hud.repairNothing') : '');
    }
    setText(this.weaponName, t(`item.${item}`));
    const slotKey = `${f.items.join(',')}|${f.slot}|${f.mags.join(',')}|${Math.ceil(f.gadgetCd)}`;
    if (slotKey !== this.lastSlotKey) {
      this.lastSlotKey = slotKey;
      this.slotsEl.replaceChildren();
      f.items.forEach((it, i) => {
        if (it === 'none') return;
        let extra = '';
        if (it === 'grenade') extra = ` ×${f.mags[i]}`;
        else if ((it === 'medpack' || it === 'ammobox') && f.gadgetCd > 0) extra = ` ${Math.ceil(f.gadgetCd)}s`;
        const el = h('span', {}, `${i + 1} ${t(`item.${it}`)}${extra}`);
        if (i === f.slot) el.classList.add('sel');
        this.slotsEl.append(el);
      });
    }
    show(this.scope, f.scoped && f.alive);

    // Crosshair reflects spread.
    const showCh = f.alive && !f.sprinting && f.phase !== 'countdown' && !f.scoped && (!f.driving || f.tankSight);
    show(this.crosshair, showCh);
    if (showCh) {
      const gap = Math.max(3, f.spreadPx);
      const ads = f.ads;
      setStyle(this.chParts[0]!, 'left', `${-gap - 9}px`);
      setStyle(this.chParts[1]!, 'left', `${gap}px`);
      setStyle(this.chParts[2]!, 'top', `${-gap - 9}px`);
      setStyle(this.chParts[3]!, 'top', `${gap}px`);
      for (let i = 0; i < 4; i++) setStyle(this.chParts[i]!, 'opacity', ads ? '0' : '1');
    }
    if (this.hitT > 0) {
      this.hitT -= dt;
      if (this.hitT <= 0) this.hitmarker.classList.remove('show');
    }

    // Capture bar.
    const zi = f.inZone;
    if (f.alive && zi >= 0 && f.zones[zi]) {
      const z = f.zones[zi]!;
      const letter = ZONES.letters[zi]!;
      const mine = z.control[f.myTeam] ?? 0;
      let text: string;
      let fill: number;
      let color: string;
      if (z.contested) {
        text = t('hud.contested', { zone: letter });
        fill = z.owner >= 0 ? z.control[z.owner]! : mine;
        color = '#ef4444';
      } else if (z.owner === f.myTeam && mine >= 100) {
        text = t('hud.holding', { zone: letter });
        fill = 100;
        color = teamColor(f.myTeam);
      } else {
        let other = -1;
        let oc = 0;
        for (let k = 0; k < z.control.length; k++) {
          if (k !== f.myTeam && z.control[k]! > oc) {
            oc = z.control[k]!;
            other = k;
          }
        }
        if (other >= 0) {
          text = t('hud.neutralizing', { zone: letter });
          fill = oc;
          color = teamColor(other);
        } else {
          text = t('hud.capturing', { zone: letter });
          fill = mine;
          color = teamColor(f.myTeam);
        }
      }
      show(this.capture, true);
      setText(this.captureText, text);
      setStyle(this.captureFill, 'width', `${fill.toFixed(1)}%`);
      setStyle(this.captureFill, 'background', color);
    } else show(this.capture, false);

    show(this.death, false);
    // Total control and no-zone warnings.
    if (f.tcTeam >= 0 && f.phase === 'live') {
      setText(this.tcEl, t('hud.totalControl', { team: teamName(f.tcTeam), s: Math.max(0, Math.ceil(60 - f.tcSeconds)) }));
      setStyle(this.tcEl, 'color', TEAM_COLORS[f.tcTeam]!);
    } else setText(this.tcEl, '');
    setText(this.warnEl, f.noZones && f.phase === 'live' ? t('hud.noZones') : '');

    // Fades.
    if (this.announceT > 0) {
      this.announceT -= dt;
      if (this.announceT <= 0) setText(this.announceEl, '');
    }
    if (this.vignetteT > 0) {
      this.vignetteT -= dt;
      setStyle(this.vignette, 'opacity', String(Math.max(0, Math.min(0.9, this.vignetteT))));
    }
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) show(this.toastEl, false);
    }
    show(this.board, f.showBoard);
    show(this.bigMapCanvas, f.showMap && !f.showBoard);
  }

  /** Interaction prompt ("hold E: enter jeep") with hold progress 0..1; null hides it. */
  setPrompt(text: string | null, progress: number): void {
    show(this.prompt, text !== null);
    if (text === null) return;
    setText(this.promptText, text);
    setStyle(this.promptFill, 'width', `${Math.round(progress * 100)}%`);
  }

  /** Vehicle panel: name, HP fraction and an info line; null hides it. */
  setVehicle(v: { name: string; hpFrac: number; info: string } | null): void {
    show(this.vpanel, v !== null);
    if (!v) return;
    setText(this.vname, v.name);
    setStyle(this.vhpFill, 'width', `${Math.max(0, Math.min(100, v.hpFrac * 100)).toFixed(0)}%`);
    setStyle(this.vhpFill, 'background', v.hpFrac < 0.3 ? '#ef4444' : '#e5e7eb');
    setText(this.vinfo, v.info);
  }

  /** Move the crosshair to a screen position (top-down cursor); null = screen centre. */
  setCrosshairPos(x: number | null, y = 0): void {
    const l = x === null ? '50%' : `${Math.round(x)}px`;
    const tp = x === null ? '50%' : `${Math.round(y)}px`;
    setStyle(this.crosshair, 'left', l);
    setStyle(this.crosshair, 'top', tp);
    setStyle(this.hitmarker, 'left', l);
    setStyle(this.hitmarker, 'top', tp);
  }

  /** Where the tank turret is being steered to (screen px), or null. */
  setAimMarker(x: number | null, y = 0): void {
    show(this.aimMarker, x !== null);
    if (x === null) return;
    setStyle(this.aimMarker, 'left', `${Math.round(x)}px`);
    setStyle(this.aimMarker, 'top', `${Math.round(y)}px`);
  }

  hit(head: boolean, kill: boolean): void {
    this.hitmarker.classList.toggle('head', head);
    this.hitmarker.classList.toggle('kill', kill);
    this.hitmarker.classList.add('show');
    this.hitT = kill ? 0.3 : 0.15;
  }

  /** Damage from a direction: angle relative to view (0 = in front, clockwise). */
  damage(angle: number): void {
    const e = this.dmgDirs[this.nextDmg]!;
    this.nextDmg = (this.nextDmg + 1) % this.dmgDirs.length;
    e.style.transition = 'none';
    e.style.transform = `rotate(${angle}rad)`;
    e.style.opacity = '1';
    void e.offsetWidth;
    e.style.transition = '';
    e.style.opacity = '0';
    this.vignetteT = 0.8;
  }

  killFeed(killer: ActorInfo | undefined, victim: ActorInfo | undefined, head: boolean, w: number): void {
    const k = killer ? h('span', { style: `color:${teamColor(killer.team)}` }, `${killer.bot ? '🤖 ' : ''}${killer.name}`) : '';
    const v = victim ? h('span', { style: `color:${teamColor(victim.team)}` }, `${victim.bot ? '🤖 ' : ''}${victim.name}`) : '';
    const wname = w === -2 ? t('item.grenade') : w === -3 ? t('weapon.vehicleBoom') : w === -4 ? t('weapon.ram') : w >= 0 ? t(`item.${WEAPON_IDS[w] ?? 'ar1'}`) : t('weapon.env');
    const row = h('div', {}, k, killer ? ` [${wname}${head ? ' ⌖' : ''}] ` : '☠ ', v);
    this.killfeed.prepend(row);
    while (this.killfeed.children.length > 5) this.killfeed.lastChild?.remove();
    setTimeout(() => row.remove(), 6000);
  }

  announce(text: string, color: string): void {
    setText(this.announceEl, text);
    setStyle(this.announceEl, 'color', color);
    this.announceT = 3;
  }

  toast(text: string, seconds = 5): void {
    setText(this.toastEl, text);
    show(this.toastEl, true);
    this.toastT = seconds;
  }

  showBanner(text: string, sub: string, color: string): void {
    this.banner.replaceChildren(h('div', { class: 'big', style: `color:${color}` }, text), h('div', { class: 'sub' }, sub));
    show(this.banner, true);
  }

  hideBanner(): void {
    show(this.banner, false);
  }

  renderBoard(teams: number, scores: number[], rows: BoardRow[], roster: Map<number, ActorInfo>, myId: number, zones: ZoneView[]): void {
    this.board.replaceChildren();
    for (let team = 0; team < teams; team++) {
      const tbl = h(
        'table',
        {},
        h('tr', {}, h('th', {}, t('board.player')), h('th', {}, t('board.kills')), h('th', {}, t('board.deaths')), h('th', {}, t('board.caps')), h('th', {}, t('board.ping'))),
      );
      for (const r of rows.filter((x) => roster.get(x.id)?.team === team).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)) {
        const info = roster.get(r.id)!;
        const tr = h('tr', {}, h('td', {}, `${info.bot ? '🤖 ' : ''}${info.name}`), h('td', { class: 'num' }, String(r.kills)), h('td', { class: 'num' }, String(r.deaths)), h('td', { class: 'num' }, String(r.caps)), h('td', { class: 'num' }, String(r.ping)));
        if (r.id === myId) tr.classList.add('me');
        tbl.append(tr);
      }
      const owned = zones.filter((z) => z.owner === team).length;
      this.board.append(h('div', {}, h('h3', { style: `color:${TEAM_COLORS[team]}` }, `${teamName(team)} — ${Math.floor(scores[team] ?? 0)} · ${t('lobby.zonesTotal', { n: owned })}`), tbl));
    }
  }

  setStats(text: string | null): void {
    show(this.stats, text !== null);
    if (text !== null) setText(this.stats, text);
  }
}

