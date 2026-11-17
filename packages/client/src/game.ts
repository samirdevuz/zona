import * as THREE from 'three';
import {
  ACT_AMMOBOX,
  ACT_GRENADE,
  ACT_MEDPACK,
  ACT_ROCKET,
  ACT_SHOOT,
  ACT_TORCH,
  ACTOR_FIELDS,
  AF_ALIVE,
  AF_CROUCH,
  AF_GROUND,
  AF_SPRINT,
  CLASSES,
  CLASS_IDS,
  DEG2RAD,
  GADGETS,
  MOVEMENT,
  NET,
  PROJ_GRENADE,
  SHOT_FIELDS,
  SLOT_KEEP,
  TEAM_COLORS,
  TEAM_NAME_KEYS,
  WEAPONS,
  WEAPON_IDS,
  World,
  ZONES,
  aimDir,
  applySpread,
  canSpawnAt,
  currentWeapon,
  decodeMap,
  itemAt,
  spreadDeg,
  type ActorInfo,
  type BoardRow,
  type ClassId,
  type GameEvent,
  type LobbyPlayer,
  type MapData,
  type MatchSettings,
  type MeNet,
  type Phase,
  type ServerMsg,
  type SnapshotMsg,
  type Vec3,
  type WinReason,
} from '@zona/shared';
import type { Audio } from './audio';
import { t } from './i18n';
import { PITCH_LIMIT, type Input } from './input';
import { SnapshotBuffer, type RemoteSample } from './interp';
import type { Net } from './net';
import { LocalPredictor } from './prediction';
import { classFromIndex, type Character } from './render/characters';
import type { View } from './render/view';
import type { ViewmodelState } from './render/viewmodel';
import { BASE_SENSITIVITY, sessionSet, type Settings } from './settings';
import { h, setStyle, setText } from './ui/dom';
import type { Hud, HudFrame, ZoneView } from './ui/hud';
import type { Menus } from './ui/menus';
import { Minimap, type MapDot, type MinimapView } from './ui/minimap';
import { SpawnScreen } from './ui/spawn';

interface LobbyState {
  phase: Phase;
  players: LobbyPlayer[];
  adminId: number;
  settings: MatchSettings;
}

interface MatchState {
  map: MapData;
  world: World;
  settings: MatchSettings;
  roster: Map<number, ActorInfo>;
  characters: Map<number, Character>;
  nameTags: Map<number, HTMLElement>;
  zoneMarkers: { el: HTMLElement; pip: HTMLElement; dist: HTMLElement }[];
  predictor: LocalPredictor;
  minimap: Minimap;
  zones: ZoneView[];
  scores: number[];
  me: MeNet | null;
  board: BoardRow[];
  tc: number[];
  result: { winner: number; reason: WinReason; scores: number[]; rows: BoardRow[] } | null;
  /** Enemies seen firing recently: id -> time (ms). */
  spotted: Map<number, number>;
}

const SHOT_WORLD = 1;
const TEAM_KEY = (team: number): string => t(TEAM_NAME_KEYS[team] ?? 'team.blue');
const SPOT_MS = 3000;
const STEP_LEN = 2.1;

/** Client-side game: glues network, prediction, interpolation, rendering, UI and audio. */
export class GameClient {
  myId = -1;
  lobby: LobbyState | null = null;
  match: MatchState | null = null;
  phase: Phase = 'lobby';
  timeLeft = -1;
  readonly spawn: SpawnScreen;
  private readonly snaps = new SnapshotBuffer();
  private yaw = 0;
  private pitch = 0;
  private recoilPitch = 0;
  private recoilYaw = 0;
  private swayT = 0;
  private sinceShot = 1;
  private acc = 0;
  private readonly out: number[] = [];
  private outSeq = 0;
  private lastSend = 0;
  private meAlive = false;
  private eyeH: number = MOVEMENT.eyeHeight;
  private camY = 0;
  private adsT = 0;
  private killerName = '';
  private showStats = false;
  private fpsAvg = 60;
  private lowFpsT = 0;
  private suggested = false;
  private tickMs = 0;
  private lastReload = 0;
  private lastSlot = -1;
  private stride = 0;
  private torchT = 0;
  private announcedMinute = false;
  // Spawn-screen selection.
  private spawnClass: ClassId = 'assault';
  private spawnZone = -1;
  private ready = false;
  // Scratch objects (no per-frame allocation).
  private readonly eye = new THREE.Vector3();
  private readonly v3 = new THREE.Vector3();
  private readonly v3b = new THREE.Vector3();
  private readonly dir: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly sample: RemoteSample = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, flags: 0, speed: 0 };
  private readonly pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, speed: 0, crouched: false, onGround: true, sprinting: false, alive: true };
  private readonly vm: ViewmodelState = { speed: 0, onGround: true, ads: false, sprinting: false, reloadFrac: 0, switchFrac: 0, throwFrac: 0, lookDX: 0, lookDY: 0, scoped: false };
  private readonly mapView: MinimapView = { zones: [], me: null, dots: [], selected: -1, selectable: [], time: 0 };
  private readonly mapCentre = { x: 0, z: 0, yaw: 0, radiusM: 90 };
  private readonly dotPool: MapDot[] = [];
  private readonly frameData: HudFrame = {
    phase: 'lobby',
    timeLeft: 0,
    scores: [],
    zones: [],
    myTeam: 0,
    alive: false,
    hp: 0,
    maxHp: 100,
    ammo: 0,
    reserve: 0,
    reloadT: 0,
    protectT: 0,
    oobT: 0,
    respawnT: 0,
    sprinting: false,
    ads: false,
    spreadPx: 0,
    inZone: -1,
    spawnZone: -1,
    spawnable: [],
    killerName: '',
    showBoard: false,
    items: ['none', 'none', 'none', 'none'],
    slot: 0,
    mags: [0, 0, 0, 0],
    res: [0, 0, 0, 0],
    gadgetCd: 0,
    scoped: false,
    tcTeam: -1,
    tcSeconds: 0,
    noZones: false,
  };
  /** Testing: events seen (for E2E). */
  readonly seenKills: { killer: number; victim: number; w: number }[] = [];
  readonly seenCaptures: { zone: number; team: number }[] = [];
  readonly seenBooms: { x: number; z: number }[] = [];
  corrections = { count: 0, max: 0, sum: 0 };

  constructor(
    private readonly view: View,
    private readonly hud: Hud,
    private readonly menus: Menus,
    private readonly input: Input,
    private readonly audio: Audio,
    private readonly net: Net,
    private settings: Settings,
    uiRoot: HTMLElement,
  ) {
    input.onKey = (code) => this.onKey(code);
    input.onLockChange = (locked) => this.onLockChange(locked);
    this.spawn = new SpawnScreen(uiRoot, {
      selectClass: (c) => this.selectClass(c),
      selectZone: (z) => this.selectZone(z),
      deploy: () => this.deploy(),
    });
  }

  setSettings(s: Settings): void {
    this.settings = s;
    this.view.applySettings(s);
    this.audio.setVolumes(s.volume, s.sfxVolume);
  }

  // ---- Network -----------------------------------------------------------

  onMessage(m: ServerMsg): void {
    switch (m.t) {
      case 'welcome':
        this.myId = m.id;
        sessionSet('zona.token', m.token);
        break;
      case 'lobby/state':
        this.onLobby(m);
        break;
      case 'match/start':
        this.startMatch(m.map ? decodeMap(m.map) : null, m.settings, m.roster);
        break;
      case 'roster':
        if (this.match) this.setRoster(m.roster);
        break;
      case 'snapshot':
        this.onSnapshot(m);
        break;
      case 'event':
        for (const e of m.e) this.onEvent(e);
        break;
      case 'board':
        this.tickMs = m.tickMs;
        if (this.match) {
          this.match.board = m.rows;
          if (this.input.tabHeld) this.renderBoard();
        }
        break;
      case 'match/end':
        if (this.match) {
          this.match.result = { winner: m.winner, reason: m.reason, scores: m.scores, rows: m.rows };
          const text = m.winner >= 0 ? t('end.wins', { team: TEAM_KEY(m.winner) }) : t('end.draw');
          this.hud.showBanner(text, t(`end.reason.${m.reason}`), m.winner >= 0 ? TEAM_COLORS[m.winner]! : '#fff');
          this.audio.captured(m.winner === this.myTeam());
          this.spawn.setVisible(false);
        }
        break;
      case 'error':
        this.menus.showMenu(t(`error.${m.code}`) !== `error.${m.code}` ? t(`error.${m.code}`) : m.message);
        break;
      default:
        break;
    }
  }

  private onLobby(m: LobbyState): void {
    const prevPhase = this.lobby?.phase;
    this.lobby = m;
    if (m.phase === 'lobby') {
      if (this.match) this.endMatch();
      if (prevPhase !== 'lobby' || this.menus.rootEl.querySelector('.screen:not(.hidden)') === null) this.menus.showLobby(m, this.myId);
      else this.menus.updateLobby(m, this.myId);
    } else if (m.phase === 'results' && this.match?.result) {
      this.input.enabled = false;
      if (document.pointerLockElement) document.exitPointerLock();
      this.menus.showPause(false);
      this.spawn.setVisible(false);
      this.hud.setVisible(false);
      this.menus.showResults({ ...this.match.result, roster: this.match.roster, myId: this.myId }, Math.max(0, this.timeLeft), m.adminId === this.myId);
    } else if (!this.match) {
      this.menus.showLobby(m, this.myId);
    } else {
      this.menus.updateLobby(m, this.myId);
    }
  }

  private startMatch(map: MapData | null, settings: MatchSettings, roster: ActorInfo[]): void {
    if (!map) return;
    if (this.match) this.endMatch();
    const world = new World(map);
    this.view.loadMap(map, world.terrain);
    this.view.entities.clear();
    const predictor = new LocalPredictor(world);
    const minimap = new Minimap(map, world.terrain);
    this.match = {
      map,
      world,
      settings,
      roster: new Map(),
      characters: new Map(),
      nameTags: new Map(),
      zoneMarkers: [],
      predictor,
      minimap,
      zones: map.zones.map((z) => ({ owner: z.homeTeam, contested: false, control: new Array<number>(map.teams).fill(0) })),
      scores: new Array<number>(map.teams).fill(0),
      me: null,
      board: [],
      tc: [],
      result: null,
      spotted: new Map(),
    };
    for (const z of map.zones) {
      const pip = h('span', { class: 'pip' }, z.letter);
      const dist = h('div', { class: 'num' });
      const el = h('div', { class: 'marker' }, pip, dist);
      this.hud.markers.append(el);
      this.match.zoneMarkers.push({ el, pip, dist });
    }
    this.setRoster(roster);
    this.snaps.clear();
    this.meAlive = false;
    this.acc = 0;
    this.out.length = 0;
    this.recoilPitch = this.recoilYaw = 0;
    this.spawnZone = -1;
    this.ready = false;
    this.killerName = '';
    this.announcedMinute = false;
    this.lastSlot = -1;
    this.spawn.setMinimap(minimap);
    this.hud.setupMatch(map.teams, map.zones.map((z) => z.letter));
    this.hud.setVisible(true);
    this.menus.hideScreens();
    this.input.enabled = true;
    this.view.viewmodel.visible = true;
    this.corrections = { count: 0, max: 0, sum: 0 };
    // Tell the server our remembered class right away (players pick during the countdown).
    this.sendSpawn();
  }

  private endMatch(): void {
    const m = this.match;
    if (!m) return;
    for (const c of m.characters.values()) {
      this.view.scene.remove(c.root);
      c.dispose();
    }
    this.hud.markers.replaceChildren();
    this.view.unloadMap();
    this.view.entities.clear();
    this.match = null;
    this.spawn.setMinimap(null);
    this.spawn.setVisible(false);
    this.hud.setVisible(false);
    this.hud.hideBanner();
    this.input.enabled = false;
    this.menus.showPause(false);
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private setRoster(list: ActorInfo[]): void {
    const m = this.match!;
    const ids = new Set(list.map((a) => a.id));
    for (const [id, c] of m.characters) {
      if (!ids.has(id) || m.roster.get(id)?.team !== list.find((a) => a.id === id)?.team) this.removeCharacter(m, id, c);
    }
    m.roster.clear();
    for (const a of list) m.roster.set(a.id, a);
    for (const a of list) {
      if (a.id === this.myId || m.characters.has(a.id)) continue;
      this.addCharacter(m, a.id, a.team, 'assault');
      const tag = h('div', { class: 'marker name hidden', style: `color:${TEAM_COLORS[a.team]}` }, a.name);
      this.hud.markers.append(tag);
      m.nameTags.set(a.id, tag);
    }
  }

  private addCharacter(m: MatchState, id: number, team: number, cls: ClassId): Character {
    const c = this.view.characters.create(team, cls, this.view.preset.shadowMapSize > 0);
    c.root.visible = false;
    this.view.scene.add(c.root);
    m.characters.set(id, c);
    return c;
  }

  private removeCharacter(m: MatchState, id: number, c: Character): void {
    this.view.scene.remove(c.root);
    c.dispose();
    m.characters.delete(id);
    m.nameTags.get(id)?.remove();
    m.nameTags.delete(id);
  }

  private myTeam(): number {
    return this.match?.roster.get(this.myId)?.team ?? 0;
  }

  private onSnapshot(s: SnapshotMsg): void {
    const m = this.match;
    if (!m) return;
    const now = performance.now();
    this.phase = s.phase;
    this.timeLeft = s.timeLeft;
    if (s.phase === 'results') this.menus.updateResultsTimer(s.timeLeft);
    const T = m.map.teams;
    for (let i = 0, o = 0; i < m.zones.length; i++) {
      const z = m.zones[i]!;
      z.owner = s.z[o]!;
      z.contested = s.z[o + 1] === 1;
      for (let k = 0; k < T; k++) z.control[k] = s.z[o + 2 + k]!;
      o += 2 + T;
    }
    for (let i = 0; i < T; i++) m.scores[i] = s.s[i]!;
    m.tc = s.tc;
    this.snaps.push(s.tick, s.a, now);
    this.view.entities.onSnapshot(s.p, s.d, now);
    // Swap character models when an actor's class changed (respawn as another class).
    for (let i = 0; i + ACTOR_FIELDS - 1 < s.a.length; i += ACTOR_FIELDS) {
      const id = s.a[i]!;
      const cls = classFromIndex(s.a[i + 8]!);
      const c = m.characters.get(id);
      if (c && c.cls !== cls) {
        const team = c.team;
        this.view.scene.remove(c.root);
        c.dispose();
        m.characters.delete(id);
        this.addCharacter(m, id, team, cls);
      }
    }
    const me = s.me;
    m.me = me;
    if (me) {
      const p = m.predictor;
      if (!me.alive) {
        if (this.meAlive && !this.input.testMode && document.pointerLockElement) document.exitPointerLock();
        this.meAlive = false;
        this.out.length = 0;
      } else if (!this.meAlive) {
        this.meAlive = true;
        this.ready = false;
        p.reset(me.st);
        this.yaw = me.st.yaw;
        this.pitch = me.st.pitch;
        this.recoilPitch = this.recoilYaw = 0;
        this.camY = me.st.y;
        this.killerName = '';
        this.lastSlot = -1;
        this.spawn.setVisible(false);
        if (!this.input.locked && !this.input.testMode) this.menus.showPause(true);
      } else if (s.phase === 'live') {
        p.reconcile(s.ack, me.st);
        if (p.lastCorrection > 1e-6) {
          this.corrections.count++;
          this.corrections.max = Math.max(this.corrections.max, p.lastCorrection);
          this.corrections.sum += p.lastCorrection;
        }
      } else {
        p.reset(me.st);
      }
    }
    // Shots from the server: remote tracers + impacts; own shots only impacts.
    const myTeam = this.myTeam();
    for (let i = 0; i + SHOT_FIELDS - 1 < s.shots.length; i += SHOT_FIELDS) {
      const id = s.shots[i]!;
      const ex = s.shots[i + 1]!;
      const ey = s.shots[i + 2]!;
      const ez = s.shots[i + 3]!;
      const kind = s.shots[i + 4]!;
      const weapon = WEAPON_IDS[s.shots[i + 5]!] ?? 'ar1';
      if (kind >= SHOT_WORLD) this.view.effects.impact(ex, ey, ez, kind);
      if (id === this.myId) continue;
      const c = m.characters.get(id);
      if (!c || !c.root.visible) continue;
      if (c.team !== myTeam) m.spotted.set(id, now);
      c.root.updateMatrixWorld(true);
      const mz = c.muzzle(this.v3);
      this.view.effects.tracer(mz.x, mz.y, mz.z, ex, ey, ez);
      this.view.effects.muzzleFlash(mz.x, mz.y, mz.z, false);
      this.audio.shot(mz, weapon);
    }
  }

  private onEvent(e: GameEvent): void {
    const m = this.match;
    if (!m) return;
    switch (e.k) {
      case 'kill':
        this.seenKills.push({ killer: e.killer, victim: e.victim, w: e.w });
        this.hud.killFeed(m.roster.get(e.killer), m.roster.get(e.victim), e.head, e.w);
        if (e.victim === this.myId) this.killerName = e.killer >= 0 && e.killer !== this.myId ? (m.roster.get(e.killer)?.name ?? '') : '';
        break;
      case 'hit':
        this.hud.hit(e.head, e.kill);
        this.audio.hitMarker(e.head, e.kill);
        break;
      case 'dmg': {
        const st = m.predictor.state;
        const yawTo = Math.atan2(-(e.x - st.x), -(e.z - st.z));
        let rel = yawTo - this.yaw;
        rel -= Math.round(rel / (Math.PI * 2)) * Math.PI * 2;
        this.hud.damage(-rel);
        this.audio.damaged();
        break;
      }
      case 'boom': {
        this.seenBooms.push({ x: e.x, z: e.z });
        this.view.effects.explosion(e.x, e.y, e.z, e.r);
        this.audio.explosion(this.v3.set(e.x, e.y, e.z));
        const d = this.eye.distanceTo(this.v3);
        if (d < 30) this.view.shake = Math.max(this.view.shake, (1 - d / 30) * (e.kind === PROJ_GRENADE ? 0.6 : 0.8));
        break;
      }
      case 'attack':
        if (e.team === this.myTeam()) this.hud.announce(t('announce.attack', { zone: ZONES.letters[e.zone]! }), '#fca5a5');
        break;
      case 'cap':
      case 'lost': {
        this.seenCaptures.push({ zone: e.zone, team: e.k === 'cap' ? e.team : -1 });
        const zone = ZONES.letters[e.zone]!;
        const key = e.k === 'cap' ? 'announce.captured' : 'announce.lost';
        this.hud.announce(t(key, { team: TEAM_KEY(e.team), zone }), TEAM_COLORS[e.team]!);
        const good = (e.k === 'cap') === (e.team === this.myTeam());
        this.audio.captured(good);
        break;
      }
      case 'elim':
        this.hud.announce(t('announce.eliminated', { team: TEAM_KEY(e.team) }), TEAM_COLORS[e.team]!);
        break;
      default:
        break;
    }
  }

  // ---- Spawn screen ----------------------------------------------------------

  private selectClass(c: ClassId): void {
    this.spawnClass = c;
    this.audio.switchItem();
    this.sendSpawn();
  }

  private selectZone(z: number): void {
    const m = this.match;
    if (!m || !m.zones[z] || !canSpawnAt(m.zones[z]!, this.myTeam())) return;
    this.spawnZone = z;
    this.sendSpawn();
  }

  deploy(): void {
    this.audio.unlock();
    this.ready = true;
    this.sendSpawn();
    this.input.requestLock();
  }

  private sendSpawn(): void {
    this.net.send({ t: 'spawn/request', zone: this.spawnZone, classId: this.spawnClass, ready: this.ready });
  }

  // ---- Input -------------------------------------------------------------

  private onKey(code: string): void {
    if (code === 'F3') {
      this.showStats = !this.showStats;
      if (!this.showStats) this.hud.setStats(null);
      return;
    }
    const m = this.match;
    if (!m || this.meAlive || !this.spawn.isVisible()) return;
    if (/^Digit[1-4]$/.test(code)) this.selectClass(CLASS_IDS[Number(code.slice(5)) - 1]!);
    else if (code === 'Space' || code === 'Enter') this.deploy();
    else if (/^Key[A-H]$/.test(code)) this.selectZone(code.charCodeAt(3) - 65);
  }

  private onLockChange(locked: boolean): void {
    if (!this.match || this.phase === 'results') return;
    this.menus.showPause(!locked && !this.input.testMode && this.meAlive);
  }

  resume(): void {
    this.audio.unlock();
    this.input.requestLock();
    this.menus.showPause(false);
  }

  private renderBoard(): void {
    const m = this.match;
    if (!m) return;
    this.hud.renderBoard(m.map.teams, m.scores, m.board, m.roster, this.myId, m.zones);
  }

  /** Slot requested this frame (number keys or wheel), or SLOT_KEEP. */
  private takeSlotRequest(): number {
    const st = this.match!.predictor.state;
    let req = this.input.slotReq;
    this.input.slotReq = -1;
    const wheel = this.input.wheel;
    this.input.wheel = 0;
    if (req < 0 && wheel !== 0) {
      const dir = wheel > 0 ? 1 : -1;
      let s = st.slot;
      for (let k = 0; k < 4; k++) {
        s = (s + dir + 4) % 4;
        if (itemAt(st, s) !== 'none') break;
      }
      req = s;
    }
    if (req >= 0 && (req === st.slot || itemAt(st, req) === 'none')) req = SLOT_KEEP;
    return req;
  }

  // ---- Frame -------------------------------------------------------------

  frame(dt: number): void {
    const m = this.match;
    const now = performance.now();
    this.fpsAvg = this.fpsAvg * 0.95 + (dt > 0 ? 1 / dt : 60) * 0.05;
    if (!m) {
      this.lastSend = now;
      return;
    }
    const p = m.predictor;
    const st = p.state;
    const w = currentWeapon(st) ?? WEAPONS.pistol;

    // Mouse look (render rate).
    const look = this.input.consumeLook();
    const adsSens = st.ads ? this.settings.adsSensMult / w.adsZoom : 1;
    const sens = BASE_SENSITIVITY * this.settings.sensitivity * adsSens;
    this.yaw -= look.dx * sens;
    this.pitch -= look.dy * sens * (this.settings.invertY ? -1 : 1);
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));

    // Scope sway (applied to the sent aim, so the server shoots where the view points).
    this.swayT += dt;
    const scopedNow = w.scope && st.ads && this.adsT > 0.85 && this.meAlive;
    const swayAmp = scopedNow ? w.swayDeg * DEG2RAD * (st.crouched ? 0.5 : 1) : 0;
    const swayYaw = Math.sin(this.swayT * 0.9) * swayAmp;
    const swayPitch = Math.sin(this.swayT * 1.3 + 1) * swayAmp * 0.6;

    // Fixed-step prediction and input sending.
    const simulate = this.phase === 'live' && this.meAlive;
    if (simulate) {
      let slotReq = this.takeSlotRequest();
      this.acc += Math.min(dt, 0.25);
      while (this.acc >= NET.MOVE_DT) {
        const aimYaw = this.yaw + this.recoilYaw + swayYaw;
        const aimPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch + this.recoilPitch + swayPitch));
        const b = this.input.active() ? this.input.takeButtons() : 0;
        const r = p.step(b, aimYaw, aimPitch, slotReq);
        if (this.out.length === 0) this.outSeq = r.seq;
        this.out.push(b, aimYaw, aimPitch, slotReq);
        slotReq = SLOT_KEEP;
        if (r.act !== 0) this.onLocalAction(r.act);
        this.acc -= NET.MOVE_DT;
      }
      if (slotReq !== SLOT_KEEP) this.input.slotReq = slotReq; // no step ran this frame: keep it
      if (this.out.length >= 8 || (this.out.length > 0 && now - this.lastSend > 40)) {
        this.net.send({ t: 'input', seq: this.outSeq, steps: this.out });
        this.out.length = 0; // serialized synchronously above, safe to reuse
        this.lastSend = now;
      }
      if (st.reloadT > 0 && this.lastReload <= 0) this.audio.reload(st.reloadT);
      this.lastReload = st.reloadT;
      if (st.slot !== this.lastSlot) {
        if (this.lastSlot >= 0) this.audio.switchItem();
        this.lastSlot = st.slot;
      }
      // Local footsteps.
      if (st.onGround) {
        this.stride += Math.sqrt(st.vx * st.vx + st.vz * st.vz) * dt;
        if (this.stride > STEP_LEN) {
          this.stride = 0;
          if (!st.crouched) this.audio.footstep(null, st.sprinting);
        }
      }
    } else {
      this.acc = 0;
      this.input.slotReq = -1;
      this.input.wheel = 0;
    }
    this.view.viewmodel.setItem(itemAt(st, st.slot));
    // Recoil recovery.
    this.sinceShot += dt;
    if (this.sinceShot > 0.12) {
      const rec = w.recoilRecoverDegPerS * DEG2RAD * dt;
      this.recoilPitch = this.recoilPitch > rec ? this.recoilPitch - rec : 0;
      this.recoilYaw *= Math.exp(-dt * 6);
    }
    p.decayError(dt);

    // Camera.
    const alpha = simulate ? this.acc / NET.MOVE_DT : 1;
    const rx = p.prev.x + (st.x - p.prev.x) * alpha + p.err.x;
    const ry = p.prev.y + (st.y - p.prev.y) * alpha + p.err.y;
    const rz = p.prev.z + (st.z - p.prev.z) * alpha + p.err.z;
    if (this.meAlive) {
      this.camY = ry > this.camY && st.onGround && ry - this.camY < 0.6 ? this.camY + (ry - this.camY) * Math.min(1, dt * 25) : ry;
      const targetEye = st.crouched ? MOVEMENT.crouchEyeHeight : MOVEMENT.eyeHeight;
      this.eyeH += (targetEye - this.eyeH) * Math.min(1, dt * 12);
      this.eye.set(rx, this.camY + this.eyeH, rz);
    } else {
      this.eye.y += (this.camY + 0.5 - this.eye.y) * Math.min(1, dt * 3);
    }
    let shakeYaw = 0;
    let shakePitch = 0;
    if (this.view.shake > 0.001) {
      shakeYaw = (Math.random() - 0.5) * this.view.shake * 0.04;
      shakePitch = (Math.random() - 0.5) * this.view.shake * 0.04;
      this.view.shake *= Math.exp(-dt * 6);
    }
    const viewPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch + this.recoilPitch + swayPitch + shakePitch));
    this.view.rig.apply(this.view.camera, this.eye, this.yaw + this.recoilYaw + swayYaw + shakeYaw, viewPitch);
    this.adsT += ((st.ads && this.meAlive ? 1 : 0) - this.adsT) * Math.min(1, (dt / w.adsTimeS) * 2.5);
    const fov = this.settings.fov / (1 + (w.adsZoom - 1) * this.adsT);
    if (Math.abs(this.view.camera.fov - fov) > 0.01) {
      this.view.camera.fov = fov;
      this.view.camera.updateProjectionMatrix();
    }
    this.view.camera.updateMatrixWorld();

    // Remote actors.
    const renderT = this.snaps.renderTime(now);
    this.view.blobs.begin();
    const terrain = m.world.terrain;
    const myTeam = this.myTeam();
    for (const [id, c] of m.characters) {
      const ok = this.snaps.sample(id, renderT, this.sample);
      c.root.visible = ok;
      const tag = m.nameTags.get(id);
      if (!ok) {
        if (tag) tag.classList.add('hidden');
        continue;
      }
      const s = this.sample;
      const f = s.flags;
      const pose = this.pose;
      pose.x = s.x;
      pose.y = s.y;
      pose.z = s.z;
      pose.yaw = s.yaw;
      pose.pitch = s.pitch;
      pose.speed = s.speed;
      pose.crouched = (f & AF_CROUCH) !== 0;
      pose.onGround = (f & AF_GROUND) !== 0;
      pose.sprinting = (f & AF_SPRINT) !== 0;
      pose.alive = (f & AF_ALIVE) !== 0;
      const before = c.stride;
      c.update(pose, dt);
      if (pose.alive && Math.floor(c.stride / STEP_LEN) !== Math.floor(before / STEP_LEN) && !pose.crouched) {
        const d2 = (s.x - this.eye.x) ** 2 + (s.z - this.eye.z) ** 2;
        if (d2 < 35 * 35) this.audio.footstep(this.v3.set(s.x, s.y, s.z), pose.sprinting);
      }
      if (pose.alive) this.view.blobs.add(s.x, terrain.heightAt(s.x, s.z), s.z);
      if (tag) this.placeTag(tag, s.x, s.y + 2.2, s.z, pose.alive && c.team === myTeam);
    }
    this.view.blobs.end();

    // Zones.
    const time = now / 1000;
    const zv = this.view.zones;
    if (zv) {
      for (let i = 0; i < m.zones.length; i++) {
        const z = m.zones[i]!;
        zv.update(i, z.owner, z.contested, z.control, time);
      }
    }
    this.updateZoneMarkers(m);

    // Effects, entities, viewmodel, audio listener.
    this.view.entities.update(now, dt, this.view.effects);
    this.view.effects.update(dt);
    const speed = Math.sqrt(st.vx * st.vx + st.vz * st.vz);
    this.view.viewmodel.visible = this.meAlive && this.phase !== 'results';
    const vm = this.vm;
    vm.speed = speed;
    vm.onGround = st.onGround;
    vm.ads = st.ads && w === currentWeapon(st);
    vm.sprinting = st.sprinting;
    vm.reloadFrac = st.reloadT > 0 ? 1 - st.reloadT / w.reloadS : 0;
    vm.switchFrac = st.switchT / GADGETS.switchTimeS;
    vm.throwFrac = st.throwT > 0 ? 1 - st.throwT / GADGETS.grenade.throwTimeS : 0;
    vm.lookDX = look.dx;
    vm.lookDY = look.dy;
    vm.scoped = scopedNow;
    this.view.viewmodel.update(dt, vm);
    aimDir(this.yaw, this.pitch, this.dir);
    this.audio.setListener(this.eye.x, this.eye.y, this.eye.z, this.dir.x, this.dir.y, this.dir.z);

    // Spawn screen while dead (or during the countdown).
    const showSpawn = !this.meAlive && (this.phase === 'countdown' || this.phase === 'live') && !m.result;
    this.spawn.setVisible(showSpawn);
    this.updateMinimapView(m, now, myTeam);
    if (showSpawn) {
      this.mapView.selected = this.frameData.spawnZone;
      this.spawn.update(
        {
          phase: this.phase,
          timeLeft: this.timeLeft,
          respawnT: m.me?.respawnT ?? 0,
          ready: this.ready,
          killerName: this.killerName,
          classId: this.spawnClass,
          zone: this.frameData.spawnZone,
          spawnable: this.frameData.spawnable,
          team: myTeam,
        },
        this.mapView,
      );
    }
    this.updateHud(m, dt, scopedNow);
    if (this.meAlive) {
      this.mapCentre.x = st.x;
      this.mapCentre.z = st.z;
      this.mapCentre.yaw = this.yaw;
      this.mapView.selected = -1;
      m.minimap.draw(this.hud.minimapCanvas.getContext('2d')!, 180, this.mapView, this.mapCentre);
    }
    this.announce(m);
    this.view.render();
    this.updateStats(dt, m);
  }

  private updateMinimapView(m: MatchState, now: number, myTeam: number): void {
    const v = this.mapView;
    v.zones = m.zones;
    v.time = now / 1000;
    v.selectable = this.frameData.spawnable;
    const st = m.predictor.state;
    v.me = this.meAlive ? { x: st.x, z: st.z, yaw: this.yaw } : null;
    let n = 0;
    for (const [id, c] of m.characters) {
      if (!c.root.visible || c.body.rotation.x > 0.1) continue;
      const enemy = c.team !== myTeam;
      if (enemy && now - (m.spotted.get(id) ?? -Infinity) > SPOT_MS) continue;
      let d = this.dotPool[n];
      if (!d) this.dotPool.push((d = { x: 0, z: 0, color: '' }));
      d.x = c.root.position.x;
      d.z = c.root.position.z;
      d.color = enemy ? '#ef4444' : TEAM_COLORS[c.team]!;
      n++;
    }
    v.dots = this.dotPool;
    this.dotPool.length = n;
  }

  private announce(m: MatchState): void {
    const limit = m.settings.timeLimitMin * 60;
    if (!this.announcedMinute && this.phase === 'live' && limit > 0 && this.timeLeft > 0 && this.timeLeft <= 60) {
      this.announcedMinute = true;
      this.hud.announce(t('announce.oneMinute'), '#fde68a');
      this.audio.countdown(true);
    }
  }

  private onLocalAction(act: number): void {
    const m = this.match!;
    const st = m.predictor.state;
    const w = currentWeapon(st);
    if (act === ACT_SHOOT || act === ACT_ROCKET) {
      if (!w) return;
      this.sinceShot = 0;
      const adsK = st.ads ? 0.65 : 1;
      this.recoilPitch += w.recoilPitchDeg * DEG2RAD * adsK;
      this.recoilYaw += (Math.random() - 0.5) * 2 * w.recoilYawDeg * DEG2RAD * adsK;
      this.view.viewmodel.fire(act === ACT_ROCKET ? 2 : w.id === 'bolt1' ? 1.6 : 1);
      const cam = this.view.camera;
      const start = this.v3b.set(0.16, -0.14, -0.7).applyQuaternion(cam.quaternion).add(cam.position);
      if (act === ACT_ROCKET) {
        this.audio.rocket(null);
        this.view.effects.smoke(start.x, start.y, start.z, 1.2, 0.8);
        return;
      }
      this.audio.shot(null, w.id);
      const ox = st.x;
      const oy = st.y + (st.crouched ? MOVEMENT.crouchEyeHeight : MOVEMENT.eyeHeight);
      const oz = st.z;
      const d = aimDir(st.yaw, st.pitch, this.dir);
      applySpread(d, spreadDeg(st), Math.random(), Math.random());
      const tHit = m.world.raycastStatic(ox, oy, oz, d.x, d.y, d.z, w.rangeM);
      const len = tHit === Infinity ? w.rangeM : tHit;
      this.view.effects.tracer(start.x, start.y, start.z, ox + d.x * len, oy + d.y * len, oz + d.z * len);
      this.view.effects.muzzleFlash(start.x, start.y, start.z, true);
    } else if (act === ACT_GRENADE) {
      this.audio.throwGrenade();
    } else if (act === ACT_MEDPACK || act === ACT_AMMOBOX) {
      this.audio.deploy();
    } else if (act === ACT_TORCH) {
      const now = performance.now();
      if (now - this.torchT > 90) {
        this.torchT = now;
        this.audio.torch();
        const cam = this.view.camera;
        const tip = this.v3b.set(0.12, -0.1, -0.75).applyQuaternion(cam.quaternion).add(cam.position);
        this.view.effects.impact(tip.x, tip.y, tip.z, 1);
      }
    }
  }

  private placeTag(el: HTMLElement, x: number, y: number, z: number, visible: boolean): void {
    if (!visible) {
      if (!el.classList.contains('hidden')) el.classList.add('hidden');
      return;
    }
    const v = this.v3.set(x, y, z).project(this.view.camera);
    const dist = this.view.camera.position.distanceTo(this.v3b.set(x, y, z));
    const on = v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 && dist < 120;
    if (on === el.classList.contains('hidden')) el.classList.toggle('hidden', !on);
    if (!on) return;
    setStyle(el, 'left', `${Math.round(((v.x + 1) / 2) * window.innerWidth)}px`);
    setStyle(el, 'top', `${Math.round(((1 - v.y) / 2) * window.innerHeight)}px`);
  }

  private updateZoneMarkers(m: MatchState): void {
    const cam = this.view.camera;
    for (let i = 0; i < m.map.zones.length; i++) {
      const z = m.map.zones[i]!;
      const mk = m.zoneMarkers[i]!;
      const state = m.zones[i]!;
      const v = this.v3.set(z.x, z.y + 10, z.z).project(cam);
      const near = (cam.position.x - z.x) ** 2 + (cam.position.z - z.z) ** 2 < 24 * 24;
      const on = v.z < 1 && v.z > -1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1 && this.phase !== 'results' && !near && this.meAlive;
      if (on === mk.el.classList.contains('hidden')) mk.el.classList.toggle('hidden', !on);
      if (!on) continue;
      setStyle(mk.el, 'left', `${Math.round(((v.x + 1) / 2) * window.innerWidth)}px`);
      setStyle(mk.el, 'top', `${Math.round(((1 - v.y) / 2) * window.innerHeight)}px`);
      setStyle(mk.pip, 'background', state.owner >= 0 ? TEAM_COLORS[state.owner]! : '#e5e7eb');
      const d = Math.round(cam.position.distanceTo(this.v3b.set(z.x, z.y, z.z)));
      setText(mk.dist, `${d} m`);
    }
  }

  private updateHud(m: MatchState, dt: number, scoped: boolean): void {
    const f = this.frameData;
    const st = m.predictor.state;
    const me = m.me;
    const team = this.myTeam();
    f.phase = this.phase;
    f.timeLeft = this.timeLeft;
    f.scores = m.scores;
    f.zones = m.zones;
    f.myTeam = team;
    f.alive = this.meAlive;
    f.hp = me?.hp ?? 0;
    f.maxHp = me?.maxHp ?? 100;
    f.reloadT = st.reloadT;
    f.protectT = me?.protectT ?? 0;
    f.oobT = me?.oobT ?? 0;
    f.respawnT = me?.respawnT ?? 0;
    f.sprinting = st.sprinting;
    f.ads = st.ads;
    const fovRad = (this.view.camera.fov * Math.PI) / 180;
    f.spreadPx = (Math.tan(spreadDeg(st) * DEG2RAD) / Math.tan(fovRad / 2)) * (window.innerHeight / 2);
    f.inZone = -1;
    if (this.meAlive) {
      const rr = ZONES.captureRadius * ZONES.captureRadius;
      for (let i = 0; i < m.map.zones.length; i++) {
        const z = m.map.zones[i]!;
        if ((st.x - z.x) ** 2 + (st.z - z.z) ** 2 <= rr && Math.abs(st.y - z.y) <= ZONES.captureHalfHeight) f.inZone = i;
      }
    }
    f.spawnable.length = 0;
    let owned = 0;
    for (let i = 0; i < m.zones.length; i++) {
      if (canSpawnAt(m.zones[i]!, team)) f.spawnable.push(i);
      if (m.zones[i]!.owner === team) owned++;
    }
    f.spawnZone = this.spawnZone >= 0 && f.spawnable.includes(this.spawnZone) ? this.spawnZone : (f.spawnable[0] ?? -1);
    f.killerName = this.killerName;
    const cls = CLASSES[st.classId];
    for (let i = 0; i < 4; i++) {
      f.items[i] = cls.slots[i]!;
      f.mags[i] = st.mag[i]!;
      f.res[i] = st.res[i]!;
    }
    f.slot = st.slot;
    f.gadgetCd = st.gadgetCd;
    f.scoped = scoped;
    f.tcTeam = m.tc.length === 2 ? m.tc[0]! : -1;
    f.tcSeconds = m.tc[1] ?? 0;
    f.noZones = owned === 0;
    const showBoard = this.input.tabHeld && this.phase !== 'results';
    if (showBoard && !f.showBoard) this.renderBoard();
    f.showBoard = showBoard;
    this.hud.update(f, dt);
  }

  private updateStats(dt: number, m: MatchState): void {
    if (this.fpsAvg < 40 && this.view.preset.id !== 'low' && !this.suggested) {
      this.lowFpsT += dt;
      if (this.lowFpsT > 5) {
        this.suggested = true;
        this.hud.toast(t('perf.suggest', { fps: Math.round(this.fpsAvg) }), 8);
      }
    } else this.lowFpsT = 0;
    if (!this.showStats) return;
    const c = this.corrections;
    this.hud.setStats(
      [
        `FPS ${this.fpsAvg.toFixed(0)}  frame ${(1000 / Math.max(1, this.fpsAvg)).toFixed(1)} ms`,
        `draw calls ${this.view.stats.calls}  tris ${this.view.stats.triangles}`,
        `preset ${this.view.preset.id}  ping ${Math.round(this.net.rtt)} ms  server tick ${this.tickMs.toFixed(2)} ms`,
        `pending ${m.predictor.pendingCount}  corrections ${c.count} (max ${c.max.toFixed(3)} m)`,
        `pos ${m.predictor.state.x.toFixed(1)} ${m.predictor.state.y.toFixed(1)} ${m.predictor.state.z.toFixed(1)}  seed ${m.map.seed}`,
      ].join('\n'),
    );
  }

  // ---- Testing hooks -------------------------------------------------------

  testState(): unknown {
    const m = this.match;
    const st = m?.predictor.state;
    const remotes: { id: number; x: number; y: number; z: number; alive: boolean }[] = [];
    if (m) {
      const renderT = this.snaps.renderTime(performance.now());
      for (const id of m.characters.keys()) {
        if (this.snaps.sample(id, renderT, this.sample)) remotes.push({ id, x: this.sample.x, y: this.sample.y, z: this.sample.z, alive: (this.sample.flags & AF_ALIVE) !== 0 });
      }
    }
    return {
      phase: this.phase,
      inMatch: !!m,
      myId: this.myId,
      team: this.myTeam(),
      alive: this.meAlive,
      hp: m?.me?.hp ?? 0,
      classId: st?.classId ?? null,
      slot: st?.slot ?? 0,
      mags: st ? [...st.mag] : [],
      pos: st ? { x: st.x, y: st.y, z: st.z } : null,
      yaw: this.yaw,
      pitch: this.pitch,
      remotes,
      zones: m?.zones.map((z) => ({ owner: z.owner, contested: z.contested, control: [...z.control] })) ?? [],
      zoneDefs: m?.map.zones.map((z) => ({ x: z.x, y: z.y, z: z.z, homeTeam: z.homeTeam })) ?? [],
      scores: m ? [...m.scores] : [],
      kills: [...this.seenKills],
      captures: [...this.seenCaptures],
      booms: [...this.seenBooms],
      result: m?.result ?? null,
      lobbyPhase: this.lobby?.phase ?? null,
      spawnVisible: this.spawn.isVisible(),
      fps: this.fpsAvg,
      drawCalls: this.view.stats.calls,
      triangles: this.view.stats.triangles,
      corrections: { ...this.corrections },
    };
  }

  setLook(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = pitch;
  }

  /** Testing: choose class/zone and deploy. */
  testSpawn(cls: ClassId, zone: number): void {
    this.spawnClass = cls;
    if (zone >= 0) this.spawnZone = zone;
    this.deploy();
  }

  testSlot(slot: number): void {
    this.input.slotReq = slot;
  }
}
