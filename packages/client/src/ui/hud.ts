import { TEAM_COLORS, TEAM_NAME_KEYS, NEUTRAL_COLOR, ZONES, type ActorInfo, type BoardRow } from '@zona/shared';
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
}

const teamColor = (t: number): string => (t >= 0 ? TEAM_COLORS[t]! : NEUTRAL_COLOR);
const teamName = (team: number): string => t(TEAM_NAME_KEYS[team] ?? 'team.blue');
const OOB_GRACE = 8;

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
  private lastSpawnKey = '';

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
    this.ammo = h('div', { class: 'ammo' }, this.ammoHint, h('div', {}, this.mag, h('span', { class: 'reserve' }, ' / '), this.reserve), h('div', { class: 'weapon' }, t('weapon.ar1')));
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
    this.root.append(this.markers, this.vignette, dmg, this.crosshair, this.hitmarker, this.strip, this.timer, this.capture, this.health, this.ammo, this.killfeed, this.announceEl, this.center, this.death, this.board, this.stats, this.toastEl, this.banner);
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
    this.lastSpawnKey = '';
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
    if (f.phase === 'countdown') centerMain = t('hud.countdown', { s: Math.ceil(f.timeLeft) });
    else if (f.alive && f.oobT > 0) {
      centerMain = t('hud.oob', { s: Math.max(0, Math.ceil(OOB_GRACE - f.oobT)) });
    }
    show(this.center, centerMain !== '');
    setText(this.centerMain, centerMain);
    setText(this.centerSub, centerSub);
    if (this.center.classList.contains('oob') !== (f.oobT > 0)) this.center.classList.toggle('oob', f.oobT > 0);

    // Health / ammo.
    show(this.health, f.alive);
    show(this.ammo, f.alive);
    setText(this.hpVal, String(Math.max(0, Math.ceil(f.hp))));
    setStyle(this.hpFill, 'width', `${Math.max(0, Math.min(100, (f.hp / f.maxHp) * 100)).toFixed(0)}%`);
    const low = f.hp < f.maxHp * 0.35;
    if (this.health.classList.contains('low') !== low) this.health.classList.toggle('low', low);
    show(this.protect, f.protectT > 0);
    setText(this.mag, String(f.ammo));
    setText(this.reserve, String(f.reserve));
    setText(this.ammoHint, f.reloadT > 0 ? t('hud.reloading') : f.ammo === 0 && f.reserve === 0 ? t('hud.noAmmo') : f.ammo <= 7 ? t('hud.reload') : '');

    // Crosshair reflects spread.
    const showCh = f.alive && !f.sprinting && f.phase !== 'countdown';
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

    // Death panel.
    const dead = !f.alive && (f.phase === 'live' || f.phase === 'countdown');
    show(this.death, dead);
    if (dead) {
      setText(this.deathTitle, f.killerName ? t('death.killedBy', { name: f.killerName }) : t('death.died'));
      if (f.spawnable.length === 0) setText(this.deathSub, t('death.noZone'));
      else if (f.respawnT > 0) setText(this.deathSub, t('death.respawnIn', { s: Math.ceil(f.respawnT) }));
      else setText(this.deathSub, t('death.deploying'));
      const key = `${f.spawnable.join(',')}|${f.spawnZone}`;
      if (key !== this.lastSpawnKey) {
        this.lastSpawnKey = key;
        this.deathZones.replaceChildren();
        for (const zi2 of f.spawnable) {
          const s = h('span', { style: `background:${teamColor(f.myTeam)};color:#111` }, `${zi2 + 1}: ${ZONES.letters[zi2]}`);
          if (zi2 === f.spawnZone) s.classList.add('sel');
          this.deathZones.append(s);
        }
      }
    }

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

  killFeed(killer: ActorInfo | undefined, victim: ActorInfo | undefined, head: boolean): void {
    const k = killer ? h('span', { style: `color:${teamColor(killer.team)}` }, killer.name) : '';
    const v = victim ? h('span', { style: `color:${teamColor(victim.team)}` }, victim.name) : '';
    const row = h('div', {}, k, killer ? ` [${t('weapon.ar1')}${head ? ' ⌖' : ''}] ` : '☠ ', v);
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

  renderBoard(teams: number, scores: number[], rows: BoardRow[], roster: Map<number, ActorInfo>, myId: number): void {
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
      this.board.append(h('div', {}, h('h3', { style: `color:${TEAM_COLORS[team]}` }, `${teamName(team)} — ${Math.floor(scores[team] ?? 0)}`), tbl));
    }
  }

  setStats(text: string | null): void {
    show(this.stats, text !== null);
    if (text !== null) setText(this.stats, text);
  }
}
