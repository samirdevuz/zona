import {
  ACTOR_FIELDS,
  AF_ADS,
  AF_ALIVE,
  AF_CROUCH,
  AF_GROUND,
  AF_PROTECT,
  AF_RELOAD,
  AF_SPRINT,
  CLASSES,
  DEFAULT_CLASS,
  HIT_HEAD,
  HIT_NONE,
  MATCH,
  MOVEMENT,
  NET,
  WEAPONS,
  World,
  ZONES,
  addZoneScore,
  aimDir,
  applySpread,
  canSpawnAt,
  checkWin,
  copyPlayerState,
  createMoveScratch,
  createPlayerState,
  createZoneState,
  eyeHeight,
  falloffMult,
  pickSpawnPoint,
  rayActor,
  spreadDeg,
  stepMovement,
  stepTotalControl,
  stepWeapon,
  stepZone,
  updateEliminations,
  type BoardRow,
  type CaptureEvents,
  type ClassId,
  type GameEvent,
  type MapData,
  type MatchResult,
  type MatchSettings,
  type MeNet,
  type PlayerState,
  type TeamStatus,
  type Vec3,
  type ZoneState,
} from '@zona/shared';

export interface Actor {
  id: number;
  name: string;
  team: number;
  bot: boolean;
  classId: ClassId;
  st: PlayerState;
  hp: number;
  maxHp: number;
  alive: boolean;
  respawnT: number;
  protectT: number;
  sinceDamage: number;
  oobT: number;
  /** Zone the player wants to spawn at next (-1 = automatic). */
  spawnZone: number;
  /** Queued input steps: flat [seq, buttons, yaw, pitch]. */
  queue: number[];
  lastQueuedSeq: number;
  /** Last processed (acknowledged) input sequence number. */
  ackSeq: number;
  kills: number;
  deaths: number;
  caps: number;
}

/** Shot entry kinds in snapshots. */
export const SHOT_NONE = 0;
export const SHOT_WORLD = 1;
export const SHOT_BODY = 2;
export const SHOT_HEAD = 3;

const r2 = (v: number): number => Math.round(v * 100) / 100;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Authoritative match simulation (GAME.md 3.2, 4). Network-agnostic. */
export class Match {
  readonly world: World;
  readonly map: MapData;
  readonly settings: MatchSettings;
  readonly teams: number;
  readonly actors = new Map<number, Actor>();
  readonly zones: ZoneState[];
  readonly scores: number[];
  readonly teamStatus: TeamStatus[];
  tick = 0;
  elapsedS = 0;
  totalControlS = 0;
  result: MatchResult | null = null;

  /** Outputs of the last tick. */
  broadcastEvents: GameEvent[] = [];
  privateEvents = new Map<number, GameEvent[]>();
  shots: number[] = [];

  private readonly scratch = createMoveScratch();
  private readonly capEv: CaptureEvents = { captured: -1, lost: -1 };
  private readonly dir: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly hitOut = { kind: 0 };
  private readonly present: number[];
  private readonly rand: () => number;

  constructor(map: MapData, settings: MatchSettings, rand: () => number = Math.random) {
    this.map = map;
    this.world = new World(map);
    this.settings = settings;
    this.teams = map.teams;
    this.rand = rand;
    this.zones = map.zones.map((z) => createZoneState(map.teams, z.homeTeam));
    this.scores = new Array<number>(map.teams).fill(0);
    this.teamStatus = Array.from({ length: map.teams }, () => ({ ownedZones: 0, alive: 0, eliminated: false }));
    this.present = new Array<number>(map.teams).fill(0);
  }

  addActor(id: number, name: string, team: number, opts: { bot?: boolean; spawnNow: boolean }): Actor {
    const classId = DEFAULT_CLASS;
    const cls = CLASSES[classId];
    const a: Actor = {
      id,
      name,
      team,
      bot: opts.bot ?? false,
      classId,
      st: createPlayerState(classId),
      hp: 0,
      maxHp: cls.hp,
      alive: false,
      respawnT: opts.spawnNow ? 0 : MATCH.respawnS,
      protectT: 0,
      sinceDamage: 0,
      oobT: 0,
      spawnZone: -1,
      queue: [],
      lastQueuedSeq: -1,
      ackSeq: -1,
      kills: 0,
      deaths: 0,
      caps: 0,
    };
    this.actors.set(id, a);
    if (opts.spawnNow) {
      const home = this.map.zones.findIndex((z) => z.homeTeam === team);
      this.trySpawn(a, home >= 0 ? home : this.firstSpawnableZone(team));
    }
    return a;
  }

  removeActor(id: number): void {
    this.actors.delete(id);
  }

  /** Queue input steps (flat [buttons, yaw, pitch] triples) starting at `seq`. */
  queueInput(id: number, seq: number, steps: number[]): void {
    const a = this.actors.get(id);
    if (!a) return;
    for (let i = 0; i + 2 < steps.length; i += 3) {
      const s = seq + i / 3;
      if (s <= a.lastQueuedSeq) continue;
      a.lastQueuedSeq = s;
      a.queue.push(s, steps[i]!, steps[i + 1]!, steps[i + 2]!);
    }
    const max = NET.MAX_INPUT_QUEUE * 4;
    if (a.queue.length > max) a.queue.splice(0, a.queue.length - max);
  }

  /** A (re)connecting client restarts its input sequence at 0. */
  resetInputSeq(id: number): void {
    const a = this.actors.get(id);
    if (!a) return;
    a.queue.length = 0;
    a.lastQueuedSeq = -1;
    a.ackSeq = -1;
  }

  setSpawnZone(id: number, zone: number): void {
    const a = this.actors.get(id);
    if (a && zone >= -1 && zone < this.map.zones.length) a.spawnZone = zone;
  }

  /** Advance the match. When `live` is false (countdown/ending) inputs are acknowledged but not simulated. */
  step(dt: number, live: boolean): void {
    this.tick++;
    if (!live) {
      for (const a of this.actors.values()) this.drainInputs(a);
      return;
    }
    this.elapsedS += dt;

    for (const a of this.actors.values()) {
      if (!a.alive) {
        this.drainInputs(a);
        continue;
      }
      const backlog = a.queue.length / 4;
      const n = Math.min(backlog, backlog > NET.INPUT_BACKLOG_CATCHUP ? NET.MAX_STEPS_PER_TICK_CATCHUP : NET.STEPS_PER_TICK);
      for (let i = 0; i < n && a.alive; i++) {
        const seq = a.queue[0]!;
        const buttons = a.queue[1]!;
        const yaw = a.queue[2]!;
        const pitch = a.queue[3]!;
        a.queue.splice(0, 4);
        a.ackSeq = seq;
        stepMovement(this.world, a.st, buttons, yaw, pitch, CLASSES[a.classId].speedMult, NET.MOVE_DT, this.scratch);
        if (stepWeapon(a.st, buttons, NET.MOVE_DT)) this.fire(a);
      }
    }

    this.stepHealth(dt);
    this.stepZones(dt);
    this.stepRespawns(dt);

    addZoneScore(this.scores, this.zones.map((z) => z.owner), dt);
    const owners = this.zones.map((z) => z.owner);
    this.totalControlS = stepTotalControl(this.totalControlS, owners, dt);
    this.updateTeamStatus();
    if (!this.result) {
      this.result = checkWin({
        scores: this.scores,
        scoreLimit: this.settings.scoreLimit,
        elapsedS: this.elapsedS,
        timeLimitS: this.settings.timeLimitMin * 60,
        owners,
        totalControlS: this.totalControlS,
        status: this.teamStatus,
      });
    }
  }

  /** Called by the session after a tick's events and shots were sent. */
  clearTickOutputs(): void {
    this.broadcastEvents = [];
    this.privateEvents.clear();
    this.shots = [];
  }

  private drainInputs(a: Actor): void {
    if (a.queue.length > 0) {
      a.ackSeq = a.queue[a.queue.length - 4]!;
      a.queue.length = 0;
    }
  }

  private pushPrivate(id: number, e: GameEvent): void {
    let list = this.privateEvents.get(id);
    if (!list) {
      list = [];
      this.privateEvents.set(id, list);
    }
    list.push(e);
  }

  private fire(a: Actor): void {
    a.protectT = 0;
    const w = WEAPONS[a.st.weapon];
    const ox = a.st.x;
    const oy = a.st.y + eyeHeight(a.st);
    const oz = a.st.z;
    const d = aimDir(a.st.yaw, a.st.pitch, this.dir);
    applySpread(d, spreadDeg(a.st), this.rand(), this.rand());
    const tStatic = this.world.raycastStatic(ox, oy, oz, d.x, d.y, d.z, w.rangeM);
    let best = tStatic;
    let target: Actor | null = null;
    let kind = HIT_NONE;
    for (const b of this.actors.values()) {
      if (b === a || !b.alive || b.team === a.team) continue;
      // Cheap reject: distance from the ray origin.
      const t = rayActor(ox, oy, oz, d.x, d.y, d.z, b.st.x, b.st.y, b.st.z, b.st.crouched, this.hitOut);
      if (t < best) {
        best = t;
        target = b;
        kind = this.hitOut.kind;
      }
    }
    const len = best === Infinity ? w.rangeM : best;
    const shotKind = target ? (kind === HIT_HEAD ? SHOT_HEAD : SHOT_BODY) : best === Infinity ? SHOT_NONE : SHOT_WORLD;
    this.shots.push(a.id, r2(ox + d.x * len), r2(oy + d.y * len), r2(oz + d.z * len), shotKind);
    if (!target) return;
    const head = kind === HIT_HEAD;
    const dmg = Math.round((head ? w.damageHead : w.damageBody) * falloffMult(w, best));
    this.applyDamage(target, a, dmg, head);
  }

  /** Apply damage from `src` (null = environment). */
  applyDamage(target: Actor, src: Actor | null, dmg: number, head: boolean): void {
    if (!target.alive || target.protectT > 0 || dmg <= 0) return;
    target.hp -= dmg;
    target.sinceDamage = 0;
    const kill = target.hp <= 0;
    if (src) {
      this.pushPrivate(src.id, { k: 'hit', target: target.id, dmg, head, kill });
      this.pushPrivate(target.id, { k: 'dmg', from: src.id, x: r2(src.st.x), z: r2(src.st.z), dmg });
    }
    if (kill) this.kill(target, src, head);
  }

  private kill(target: Actor, src: Actor | null, head: boolean): void {
    target.hp = 0;
    target.alive = false;
    target.respawnT = MATCH.respawnS;
    target.deaths++;
    target.queue.length = 0;
    target.st.vx = 0;
    target.st.vz = 0;
    if (src && src !== target) src.kills++;
    this.broadcastEvents.push({ k: 'kill', killer: src ? src.id : -1, victim: target.id, head });
  }

  private stepHealth(dt: number): void {
    const R = this.map.radius;
    for (const a of this.actors.values()) {
      if (!a.alive) continue;
      if (a.protectT > 0) a.protectT = Math.max(0, a.protectT - dt);
      a.sinceDamage += dt;
      if (a.sinceDamage >= MATCH.regenDelayS && a.hp < a.maxHp) a.hp = Math.min(a.maxHp, a.hp + MATCH.regenPerS * dt);
      const r = Math.sqrt(a.st.x * a.st.x + a.st.z * a.st.z);
      if (r > R) {
        a.oobT += dt;
        if (a.oobT > MATCH.oobGraceS) {
          a.hp -= MATCH.oobDamagePerS * dt;
          if (a.hp <= 0) this.kill(a, null, false);
        }
      } else {
        a.oobT = 0;
      }
    }
  }

  private stepZones(dt: number): void {
    const rr = ZONES.captureRadius * ZONES.captureRadius;
    for (let zi = 0; zi < this.zones.length; zi++) {
      const def = this.map.zones[zi]!;
      const z = this.zones[zi]!;
      this.present.fill(0);
      for (const a of this.actors.values()) {
        if (!a.alive) continue;
        const dx = a.st.x - def.x;
        const dz = a.st.z - def.z;
        if (dx * dx + dz * dz <= rr && Math.abs(a.st.y - def.y) <= ZONES.captureHalfHeight) this.present[a.team]!++;
      }
      stepZone(z, this.present, dt, this.capEv);
      if (this.capEv.lost >= 0) this.broadcastEvents.push({ k: 'lost', zone: zi, team: this.capEv.lost });
      if (this.capEv.captured >= 0) {
        this.broadcastEvents.push({ k: 'cap', zone: zi, team: this.capEv.captured });
        for (const a of this.actors.values()) {
          if (!a.alive || a.team !== this.capEv.captured) continue;
          const dx = a.st.x - def.x;
          const dz = a.st.z - def.z;
          if (dx * dx + dz * dz <= rr) a.caps++;
        }
      }
    }
  }

  private stepRespawns(dt: number): void {
    for (const a of this.actors.values()) {
      if (a.alive) continue;
      if (a.respawnT > 0) a.respawnT = Math.max(0, a.respawnT - dt);
      if (a.respawnT > 0 || this.teamStatus[a.team]?.eliminated) continue;
      let zone = a.spawnZone;
      if (zone < 0 || !canSpawnAt(this.zones[zone]!, a.team)) zone = this.firstSpawnableZone(a.team);
      if (zone >= 0) this.trySpawn(a, zone);
    }
  }

  /** Home zone first, then the lowest-index spawnable zone; -1 if none. */
  firstSpawnableZone(team: number): number {
    const home = this.map.zones.findIndex((z) => z.homeTeam === team);
    if (home >= 0 && canSpawnAt(this.zones[home]!, team)) return home;
    return this.zones.findIndex((z) => canSpawnAt(z, team));
  }

  private trySpawn(a: Actor, zoneIdx: number): boolean {
    if (zoneIdx < 0) return false;
    const zone = this.map.zones[zoneIdx]!;
    const zs = this.zones[zoneIdx]!;
    if (!canSpawnAt(zs, a.team)) return false;
    const enemies: { x: number; y: number; z: number }[] = [];
    for (const b of this.actors.values()) if (b.alive && b.team !== a.team) enemies.push({ x: b.st.x, y: b.st.y + MOVEMENT.eyeHeight, z: b.st.z });
    const idx = pickSpawnPoint(
      zone,
      enemies,
      (e, p) => {
        const dx = p.x - e.x;
        const dy = p.y + 1.5 - e.y;
        const dz = p.z - e.z;
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (len > 150) return false;
        return this.world.raycastStatic(e.x, e.y, e.z, dx / len, dy / len, dz / len, len) >= len - 0.01;
      },
      this.rand,
    );
    const sp = zone.spawns[idx]!;
    const cls = CLASSES[a.classId];
    const fresh = createPlayerState(a.classId);
    copyPlayerState(a.st, fresh);
    a.st.x = sp.x;
    a.st.y = sp.y;
    a.st.z = sp.z;
    a.st.yaw = sp.yaw;
    a.hp = cls.hp;
    a.maxHp = cls.hp;
    a.alive = true;
    a.protectT = MATCH.spawnProtectionS;
    a.sinceDamage = 0;
    a.oobT = 0;
    a.respawnT = 0;
    this.broadcastEvents.push({ k: 'spawn', actor: a.id });
    return true;
  }

  private updateTeamStatus(): void {
    for (const s of this.teamStatus) {
      s.ownedZones = 0;
      s.alive = 0;
    }
    for (const z of this.zones) if (z.owner >= 0) this.teamStatus[z.owner]!.ownedZones++;
    for (const a of this.actors.values()) if (a.alive) this.teamStatus[a.team]!.alive++;
    const before = this.teamStatus.map((s) => s.eliminated);
    updateEliminations(this.teamStatus);
    this.teamStatus.forEach((s, t) => {
      if (s.eliminated && !before[t]) this.broadcastEvents.push({ k: 'elim', team: t });
    });
  }

  // ---- Snapshot helpers ------------------------------------------------

  actorArray(): number[] {
    const out: number[] = [];
    for (const a of this.actors.values()) {
      const s = a.st;
      let f = 0;
      if (a.alive) f |= AF_ALIVE;
      if (s.crouched) f |= AF_CROUCH;
      if (s.onGround) f |= AF_GROUND;
      if (s.ads) f |= AF_ADS;
      if (s.sprinting) f |= AF_SPRINT;
      if (s.reloadT > 0) f |= AF_RELOAD;
      if (a.protectT > 0) f |= AF_PROTECT;
      out.push(a.id, r2(s.x), r2(s.y), r2(s.z), r3(s.yaw), r3(s.pitch), f, r2(Math.sqrt(s.vx * s.vx + s.vz * s.vz)));
    }
    if (out.length % ACTOR_FIELDS !== 0) throw new Error('actor field mismatch');
    return out;
  }

  zoneArray(): number[] {
    const out: number[] = [];
    for (const z of this.zones) {
      out.push(z.owner, z.contested ? 1 : 0);
      for (const c of z.control) out.push(r2(c));
    }
    return out;
  }

  me(id: number): MeNet | null {
    const a = this.actors.get(id);
    if (!a) return null;
    return {
      st: a.st,
      hp: Math.ceil(a.hp),
      maxHp: a.maxHp,
      alive: a.alive,
      respawnT: r2(a.respawnT),
      protectT: r2(a.protectT),
      oobT: r2(a.oobT),
      classId: a.classId,
    };
  }

  boardRows(ping: (id: number) => number): BoardRow[] {
    return [...this.actors.values()].map((a) => ({ id: a.id, kills: a.kills, deaths: a.deaths, caps: a.caps, ping: ping(a.id) }));
  }

  /** Debug/E2E: move an actor. */
  teleport(id: number, x: number, y: number, z: number, yaw: number, pitch: number): void {
    const a = this.actors.get(id);
    if (!a || !a.alive) return;
    a.st.x = x;
    a.st.y = y;
    a.st.z = z;
    a.st.vx = 0;
    a.st.vy = 0;
    a.st.vz = 0;
    a.st.yaw = yaw;
    a.st.pitch = pitch;
    a.st.onGround = false;
  }
}
