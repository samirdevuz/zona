import * as THREE from 'three';
import {
  ACTOR_FIELDS,
  AF_ALIVE,
  AF_CROUCH,
  AF_GROUND,
  AF_SPRINT,
  DEG2RAD,
  MOVEMENT,
  NET,
  SHOT_FIELDS,
  TEAM_COLORS,
  TEAM_NAME_KEYS,
  WEAPONS,
  World,
  ZONES,
  aimDir,
  applySpread,
  canSpawnAt,
  decodeMap,
  spreadDeg,
  type ActorInfo,
  type BoardRow,
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
import type { Character } from './render/characters';
import type { View } from './render/view';
import { BASE_SENSITIVITY, sessionSet, type Settings } from './settings';
import { h, setStyle, setText } from './ui/dom';
import type { Hud, HudFrame, ZoneView } from './ui/hud';
import type { Menus } from './ui/menus';

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
  zones: ZoneView[];
  scores: number[];
  me: MeNet | null;
  board: BoardRow[];
  result: { winner: number; reason: WinReason; scores: number[]; rows: BoardRow[] } | null;
}

const SHOT_WORLD = 1;
const TEAM_KEY = (team: number): string => t(TEAM_NAME_KEYS[team] ?? 'team.blue');

/** Client-side game: glues network, prediction, interpolation, rendering, UI and audio. */
export class GameClient {
  myId = -1;
  lobby: LobbyState | null = null;
  match: MatchState | null = null;
  phase: Phase = 'lobby';
  timeLeft = -1;
  private readonly snaps = new SnapshotBuffer();
  private yaw = 0;
  private pitch = 0;
  private recoilPitch = 0;
  private recoilYaw = 0;
  private sinceShot = 1;
  private acc = 0;
  private out: number[] = [];
  private outSeq = 0;
  private lastSend = 0;
  private meAlive = false;
  private eyeH: number = MOVEMENT.eyeHeight;
  private camY = 0;
  private adsT = 0;
  private spawnZone = -1;
  private killerName = '';
  private showStats = false;
  private fpsAvg = 60;
  private lowFpsT = 0;
  private suggested = false;
  private tickMs = 0;
  private lastReload = 0;
  // Scratch objects (no per-frame allocation).
  private readonly eye = new THREE.Vector3();
  private readonly v3 = new THREE.Vector3();
  private readonly v3b = new THREE.Vector3();
  private readonly dir: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly sample: RemoteSample = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, flags: 0, speed: 0 };
  private readonly pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, speed: 0, crouched: false, onGround: true, sprinting: false, alive: true };
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
  };
  /** Testing: kill events seen (for E2E). */
  readonly seenKills: { killer: number; victim: number }[] = [];
  readonly seenCaptures: { zone: number; team: number }[] = [];
  corrections = { count: 0, max: 0, sum: 0 };

  constructor(
    private readonly view: View,
    private readonly hud: Hud,
    private readonly menus: Menus,
    private readonly input: Input,
    private readonly audio: Audio,
    private readonly net: Net,
    private settings: Settings,
  ) {
    input.onKey = (code) => this.onKey(code);
    input.onLockChange = (locked) => this.onLockChange(locked);
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
    const predictor = new LocalPredictor(world);
    this.match = {
      map,
      world,
      settings,
      roster: new Map(),
      characters: new Map(),
      nameTags: new Map(),
      zoneMarkers: [],
      predictor,
      zones: map.zones.map((z) => ({ owner: z.homeTeam, contested: false, control: new Array<number>(map.teams).fill(0) })),
      scores: new Array<number>(map.teams).fill(0),
      me: null,
      board: [],
      result: null,
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
    this.out = [];
    this.recoilPitch = this.recoilYaw = 0;
    this.spawnZone = -1;
    this.killerName = '';
    this.hud.setupMatch(map.teams, map.zones.map((z) => z.letter));
    this.hud.setVisible(true);
    this.menus.hideScreens();
    this.input.enabled = true;
    this.view.viewmodel.visible = true;
    if (!this.input.locked && !this.input.testMode) this.menus.showPause(true);
    this.corrections = { count: 0, max: 0, sum: 0 };
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
    this.match = null;
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
      if (!ids.has(id) || m.roster.get(id)?.team !== list.find((a) => a.id === id)?.team) {
        this.view.scene.remove(c.root);
        c.dispose();
        m.characters.delete(id);
        m.nameTags.get(id)?.remove();
        m.nameTags.delete(id);
      }
    }
    m.roster.clear();
    for (const a of list) m.roster.set(a.id, a);
    const castShadow = this.view.preset.shadowMapSize > 0;
    for (const a of list) {
      if (a.id === this.myId || m.characters.has(a.id)) continue;
      const c = this.view.characters.create(a.team, castShadow);
      c.root.visible = false;
      this.view.scene.add(c.root);
      m.characters.set(a.id, c);
      const tag = h('div', { class: 'marker name hidden', style: `color:${TEAM_COLORS[a.team]}` }, a.name);
      this.hud.markers.append(tag);
      m.nameTags.set(a.id, tag);
    }
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
    this.snaps.push(s.tick, s.a, now);
    const me = s.me;
    m.me = me;
    if (me) {
      const p = m.predictor;
      if (!me.alive) {
        this.meAlive = false;
        this.out = [];
      } else if (!this.meAlive) {
        this.meAlive = true;
        p.reset(me.st);
        this.yaw = me.st.yaw;
        this.pitch = me.st.pitch;
        this.recoilPitch = this.recoilYaw = 0;
        this.camY = me.st.y;
        this.killerName = '';
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
    for (let i = 0; i + SHOT_FIELDS - 1 < s.shots.length; i += SHOT_FIELDS) {
      const id = s.shots[i]!;
      const ex = s.shots[i + 1]!;
      const ey = s.shots[i + 2]!;
      const ez = s.shots[i + 3]!;
      const kind = s.shots[i + 4]!;
      if (kind >= SHOT_WORLD) this.view.effects.impact(ex, ey, ez, kind);
      if (id === this.myId) continue;
      const c = m.characters.get(id);
      if (!c || !c.root.visible) continue;
      c.root.updateMatrixWorld(true);
      const mz = c.muzzle(this.v3);
      this.view.effects.tracer(mz.x, mz.y, mz.z, ex, ey, ez);
      this.view.effects.muzzleFlash(mz.x, mz.y, mz.z, false);
      this.audio.shot(mz);
    }
  }

  private onEvent(e: GameEvent): void {
    const m = this.match;
    if (!m) return;
    switch (e.k) {
      case 'kill':
        this.seenKills.push({ killer: e.killer, victim: e.victim });
        this.hud.killFeed(m.roster.get(e.killer), m.roster.get(e.victim), e.head);
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

  // ---- Input -------------------------------------------------------------

  private onKey(code: string): void {
    if (code === 'F3') {
      this.showStats = !this.showStats;
      if (!this.showStats) this.hud.setStats(null);
      return;
    }
    if (!this.match) return;
    if (!this.meAlive && code.startsWith('Digit')) {
      const zi = Number(code.slice(5)) - 1;
      const z = this.match.zones[zi];
      if (z && canSpawnAt(z, this.myTeam())) {
        this.spawnZone = zi;
        this.net.send({ t: 'spawn/request', zone: zi, classId: 'assault' });
      }
    }
  }

  private onLockChange(locked: boolean): void {
    if (!this.match || this.phase === 'results') return;
    this.menus.showPause(!locked && !this.input.testMode);
  }

  resume(): void {
    this.audio.unlock();
    this.input.requestLock();
    this.menus.showPause(false);
  }

  private renderBoard(): void {
    const m = this.match;
    if (!m) return;
    this.hud.renderBoard(m.map.teams, m.scores, m.board, m.roster, this.myId);
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
    const w = WEAPONS[st.weapon];

    // Mouse look (render rate).
    const look = this.input.consumeLook();
    const adsSens = st.ads ? this.settings.adsSensMult / w.adsZoom : 1;
    const sens = BASE_SENSITIVITY * this.settings.sensitivity * adsSens;
    this.yaw -= look.dx * sens;
    this.pitch -= look.dy * sens * (this.settings.invertY ? -1 : 1);
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));

    // Fixed-step prediction and input sending.
    const simulate = this.phase === 'live' && this.meAlive;
    if (simulate) {
      this.acc += Math.min(dt, 0.25);
      while (this.acc >= NET.MOVE_DT) {
        const aimYaw = this.yaw + this.recoilYaw;
        const aimPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch + this.recoilPitch));
        const b = this.input.active() ? this.input.buttons : 0;
        const r = p.step(b, aimYaw, aimPitch);
        if (this.out.length === 0) this.outSeq = r.seq;
        this.out.push(b, aimYaw, aimPitch);
        if (r.fired) this.onLocalFire();
        this.acc -= NET.MOVE_DT;
      }
      if (this.out.length >= 6 || (this.out.length > 0 && now - this.lastSend > 40)) {
        this.net.send({ t: 'input', seq: this.outSeq, steps: this.out });
        this.out = [];
        this.lastSend = now;
      }
      if (st.reloadT > 0 && this.lastReload <= 0) this.audio.reload();
      this.lastReload = st.reloadT;
    } else {
      this.acc = 0;
    }
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
      // Dead: sink slowly where we fell.
      this.eye.y += (this.camY + 0.5 - this.eye.y) * Math.min(1, dt * 3);
    }
    const viewPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch + this.recoilPitch));
    this.view.rig.apply(this.view.camera, this.eye, this.yaw + this.recoilYaw, viewPitch);
    this.adsT += ((st.ads && this.meAlive ? 1 : 0) - this.adsT) * Math.min(1, dt / w.adsTimeS * 2.5);
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
      c.update(pose, dt);
      if (pose.alive) this.view.blobs.add(s.x, terrain.heightAt(s.x, s.z), s.z);
      if (tag) this.placeTag(tag, s.x, s.y + 2.2, s.z, pose.alive && m.roster.get(id)?.team === this.myTeam());
    }
    this.view.blobs.end();

    // Zones.
    const time = now / 1000;
    m.zones.forEach((z, i) => this.view.zones?.update(i, z.owner, z.contested, z.control, time));
    this.updateZoneMarkers(m);

    // Effects, viewmodel, audio listener.
    this.view.effects.update(dt);
    const speed = Math.sqrt(st.vx * st.vx + st.vz * st.vz);
    this.view.viewmodel.visible = this.meAlive && this.phase !== 'results';
    this.view.viewmodel.update(dt, {
      speed,
      onGround: st.onGround,
      ads: st.ads,
      sprinting: st.sprinting,
      reloadFrac: st.reloadT > 0 ? 1 - st.reloadT / w.reloadS : 0,
      lookDX: look.dx,
      lookDY: look.dy,
    });
    aimDir(this.yaw, this.pitch, this.dir);
    this.audio.setListener(this.eye.x, this.eye.y, this.eye.z, this.dir.x, this.dir.y, this.dir.z);

    this.updateHud(m, dt);
    this.view.render();
    this.updateStats(dt, m);
  }

  private onLocalFire(): void {
    const m = this.match!;
    const w = WEAPONS[m.predictor.state.weapon];
    this.sinceShot = 0;
    const adsK = m.predictor.state.ads ? 0.65 : 1;
    this.recoilPitch += w.recoilPitchDeg * DEG2RAD * adsK;
    this.recoilYaw += (Math.random() - 0.5) * 2 * w.recoilYawDeg * DEG2RAD * adsK;
    this.view.viewmodel.fire();
    this.audio.shot(null);
    // Local tracer with a locally sampled spread (hits are decided by the server).
    const st = m.predictor.state;
    const ox = st.x;
    const oy = st.y + (st.crouched ? MOVEMENT.crouchEyeHeight : MOVEMENT.eyeHeight);
    const oz = st.z;
    const d = aimDir(st.yaw, st.pitch, this.dir);
    applySpread(d, spreadDeg(st), Math.random(), Math.random());
    const tHit = m.world.raycastStatic(ox, oy, oz, d.x, d.y, d.z, w.rangeM);
    const len = tHit === Infinity ? w.rangeM : tHit;
    // Start the tracer at the muzzle: camera-relative offset to the right and down.
    const cam = this.view.camera;
    const start = this.v3b.set(0.16, -0.14, -0.7).applyQuaternion(cam.quaternion).add(cam.position);
    this.view.effects.tracer(start.x, start.y, start.z, ox + d.x * len, oy + d.y * len, oz + d.z * len);
    this.view.effects.muzzleFlash(start.x, start.y, start.z, true);
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
    setStyle(el, 'left', `${((v.x + 1) / 2) * window.innerWidth}px`);
    setStyle(el, 'top', `${((1 - v.y) / 2) * window.innerHeight}px`);
  }

  private updateZoneMarkers(m: MatchState): void {
    const cam = this.view.camera;
    m.map.zones.forEach((z, i) => {
      const mk = m.zoneMarkers[i]!;
      const state = m.zones[i]!;
      const v = this.v3.set(z.x, z.y + 10, z.z).project(cam);
      const near = (cam.position.x - z.x) ** 2 + (cam.position.z - z.z) ** 2 < 24 * 24;
      const on = v.z < 1 && v.z > -1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1 && this.phase !== 'results' && !near;
      if (on === mk.el.classList.contains('hidden')) mk.el.classList.toggle('hidden', !on);
      if (!on) return;
      setStyle(mk.el, 'left', `${((v.x + 1) / 2) * window.innerWidth}px`);
      setStyle(mk.el, 'top', `${((1 - v.y) / 2) * window.innerHeight}px`);
      setStyle(mk.pip, 'background', state.owner >= 0 ? TEAM_COLORS[state.owner]! : '#e5e7eb');
      const d = Math.round(cam.position.distanceTo(this.v3b.set(z.x, z.y, z.z)));
      setText(mk.dist, `${d} m`);
    });
  }

  private updateHud(m: MatchState, dt: number): void {
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
    f.ammo = st.ammo;
    f.reserve = st.reserve;
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
      m.map.zones.forEach((z, i) => {
        if ((st.x - z.x) ** 2 + (st.z - z.z) ** 2 <= rr && Math.abs(st.y - z.y) <= ZONES.captureHalfHeight) f.inZone = i;
      });
    }
    f.spawnable.length = 0;
    m.zones.forEach((z, i) => {
      if (canSpawnAt(z, team)) f.spawnable.push(i);
    });
    f.spawnZone = this.spawnZone >= 0 && f.spawnable.includes(this.spawnZone) ? this.spawnZone : (f.spawnable[0] ?? -1);
    f.killerName = this.killerName;
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
      pos: st ? { x: st.x, y: st.y, z: st.z } : null,
      yaw: this.yaw,
      pitch: this.pitch,
      remotes,
      zones: m?.zones.map((z) => ({ owner: z.owner, contested: z.contested, control: [...z.control] })) ?? [],
      zoneDefs: m?.map.zones.map((z) => ({ x: z.x, y: z.y, z: z.z, homeTeam: z.homeTeam })) ?? [],
      scores: m ? [...m.scores] : [],
      kills: [...this.seenKills],
      captures: [...this.seenCaptures],
      result: m?.result ?? null,
      lobbyPhase: this.lobby?.phase ?? null,
      fps: this.fpsAvg,
      drawCalls: this.view.stats.calls,
      triangles: this.view.stats.triangles,
      corrections: { ...this.corrections },
      actorFields: ACTOR_FIELDS,
    };
  }

  setLook(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = pitch;
  }
}
