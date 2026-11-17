import {
  ACTOR_FIELDS,
  ACT_TORCH,
  BTN,
  ACT_AMMOBOX,
  ACT_GRENADE,
  ACT_MEDPACK,
  ACT_ROCKET,
  ACT_SHOOT,
  AF_ADS,
  AF_ALIVE,
  AF_CROUCH,
  AF_GROUND,
  AF_PROTECT,
  AF_RELOAD,
  AF_SPRINT,
  CLASSES,
  CLASS_IDS,
  DEFAULT_CLASS,
  BOOM_VEHICLE,
  DEP_AMMOBOX,
  DEP_MEDPACK,
  GADGETS,
  HIT_HEAD,
  HIT_NONE,
  MATCH,
  MOVEMENT,
  NET,
  PROJ_GRENADE,
  PROJ_ROCKET,
  PROJ_SHELL,
  RESUPPLY,
  TANK,
  VACT_CANNON,
  VACT_MG,
  VEHICLES,
  VEHICLE_KINDS,
  VEHICLE_RULES,
  VEH_FIELDS,
  VF_DESTROYED,
  W_RAM,
  W_VEHICLE_BOOM,
  WEAPONS,
  WEAPON_IDS,
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
  createVehicleScratch,
  createVehicleState,
  createZoneState,
  distToVehicle,
  currentWeapon,
  eyeHeight,
  falloffMult,
  loadout,
  pickSpawnPoint,
  pushOutOfVehicle,
  rayVehicle,
  standingClear,
  stepVehicle,
  vehiclePoint,
  wrapAngle,
  rayActor,
  refillAmmo,
  splashDamage,
  spreadDeg,
  stepInventory,
  stepMovement,
  stepProjectile,
  stepTotalControl,
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
  type Projectile,
  type ProjectileStep,
  type TeamStatus,
  type Vec3,
  type VehicleKind,
  type VehicleState,
  type WeaponDef,
  type WeaponId,
  type ZoneState,
} from '@zona/shared';

/** Queue entry size: seq, buttons, yaw, pitch, slot. */
/** Queued input entry: seq, buttons, yaw, pitch, slot, view time (lag compensation). */
const Q = 6;
/** Position history kept for lag compensation (ticks). */
const HIST = 12;
const TICK_MS = 1000 / NET.SERVER_TICK_HZ;

export interface Actor {
  id: number;
  name: string;
  team: number;
  bot: boolean;
  classId: ClassId;
  /** Class and zone chosen on the spawn screen for the next deployment. */
  nextClass: ClassId;
  spawnZone: number;
  /** Pressed "Deploy" on the spawn screen. */
  ready: boolean;
  st: PlayerState;
  hp: number;
  maxHp: number;
  alive: boolean;
  respawnT: number;
  /** Seconds since death (for the AFK auto-deploy). */
  deadT: number;
  protectT: number;
  sinceDamage: number;
  oobT: number;
  /** Fractional refill carry per slot. */
  ammoAcc: number[];
  queue: number[];
  lastQueuedSeq: number;
  /** View time (server ms) of the input being processed (0 = none: bots, old clients). */
  rt: number;
  /** Ring buffer of past positions: time, x, y, z, crouched (lag compensation). */
  hist: Float64Array;
  histN: number;
  histHead: number;
  /** Last processed (acknowledged) input sequence number. */
  ackSeq: number;
  kills: number;
  deaths: number;
  caps: number;
  /** Vehicle id and seat (-1 = on foot). */
  vehicle: number;
  seat: number;
  /** Seconds the use key (E) has been held; needs a release between toggles. */
  useT: number;
  useLatch: boolean;
  /** Ramming damage cooldown. */
  ramT: number;
}

export interface Vehicle {
  id: number;
  kind: VehicleKind;
  pad: number;
  st: VehicleState;
  hp: number;
  /** Team of the occupants, -1 when empty (team-neutral until entered). */
  team: number;
  seats: number[];
  destroyed: boolean;
  wreckT: number;
  /** Seconds unoccupied away from its pad. */
  emptyT: number;
  /** Driver input steps applied this tick. */
  driven: number;
}

export interface Pad {
  zone: number;
  kind: VehicleKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  vehicle: number;
  respawnT: number;
}

export interface Deployable {
  id: number;
  kind: number;
  owner: number;
  team: number;
  x: number;
  y: number;
  z: number;
  t: number;
}

/** Shot entry kinds in snapshots. */
export const SHOT_NONE = 0;
export const SHOT_WORLD = 1;
export const SHOT_BODY = 2;
export const SHOT_HEAD = 3;

/** Kill-feed weapon codes for non-gun kills. */
export const W_ENV = -1;
export const W_GRENADE = -2;

const r2 = (v: number): number => Math.round(v * 100) / 100;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const widx = (w: WeaponId): number => WEAPON_IDS.indexOf(w);

/** Authoritative match simulation (GAME.md 3.2, 4, 5). Network-agnostic. */
export class Match {
  readonly world: World;
  readonly map: MapData;
  readonly settings: MatchSettings;
  readonly teams: number;
  readonly actors = new Map<number, Actor>();
  readonly zones: ZoneState[];
  readonly scores: number[];
  readonly teamStatus: TeamStatus[];
  readonly projectiles: Projectile[] = [];
  readonly deployables: Deployable[] = [];
  readonly vehicles = new Map<number, Vehicle>();
  readonly pads: Pad[] = [];
  private readonly vscratch = createVehicleScratch();
  private readonly tmpP = { x: 0, y: 0, z: 0 };
  tick = 0;
  elapsedS = 0;
  totalControlS = 0;
  result: MatchResult | null = null;

  /** Outputs of the last tick. */
  broadcastEvents: GameEvent[] = [];
  privateEvents = new Map<number, GameEvent[]>();
  shots: number[] = [];

  private nextEntityId = 1;
  private readonly lastAttack: number[];
  private readonly scratch = createMoveScratch();
  private readonly capEv: CaptureEvents = { captured: -1, lost: -1 };
  private readonly dir: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly hitOut = { kind: 0 };
  private readonly projOut: ProjectileStep = { exploded: false, bounced: false };
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
    this.lastAttack = map.zones.map(() => -Infinity);
    if (settings.vehicles !== false) {
      map.zones.forEach((z, zi) => {
        const add = (kind: VehicleKind, p: { x: number; y: number; z: number; yaw: number } | null): void => {
          if (p) this.pads.push({ zone: zi, kind, x: p.x, y: p.y, z: p.z, yaw: p.yaw, vehicle: -1, respawnT: 0 });
        };
        add('jeep', z.jeepPad);
        add('tank', z.tankPad);
      });
    }
  }

  addActor(id: number, name: string, team: number, opts: { bot?: boolean; spawnNow: boolean; classId?: ClassId }): Actor {
    const classId = opts.classId ?? DEFAULT_CLASS;
    const a: Actor = {
      id,
      name,
      team,
      bot: opts.bot ?? false,
      classId,
      nextClass: classId,
      spawnZone: -1,
      ready: false,
      st: createPlayerState(classId),
      hp: 0,
      maxHp: CLASSES[classId].hp,
      alive: false,
      respawnT: opts.spawnNow ? 0 : MATCH.respawnS,
      deadT: 0,
      protectT: 0,
      sinceDamage: 0,
      oobT: 0,
      ammoAcc: [0, 0, 0, 0],
      queue: [],
      lastQueuedSeq: -1,
      rt: 0,
      hist: new Float64Array(HIST * 5),
      histN: 0,
      histHead: 0,
      ackSeq: -1,
      kills: 0,
      deaths: 0,
      caps: 0,
      vehicle: -1,
      seat: -1,
      useT: 0,
      useLatch: false,
      ramT: 0,
    };
    this.actors.set(id, a);
    if (opts.spawnNow) {
      const home = this.map.zones.findIndex((z) => z.homeTeam === team);
      this.trySpawn(a, home >= 0 ? home : this.firstSpawnableZone(team));
    }
    return a;
  }

  removeActor(id: number): void {
    const a = this.actors.get(id);
    if (a) this.leaveVehicle(a, false);
    this.actors.delete(id);
    for (let i = this.deployables.length - 1; i >= 0; i--) if (this.deployables[i]!.owner === id) this.deployables.splice(i, 1);
  }

  /** Queue input steps (flat [buttons, yaw, pitch, slot] quads) starting at `seq`. */
  queueInput(id: number, seq: number, steps: number[], rt = 0): void {
    const a = this.actors.get(id);
    if (!a) return;
    for (let i = 0; i + 3 < steps.length; i += 4) {
      const s = seq + i / 4;
      if (s <= a.lastQueuedSeq) continue;
      a.lastQueuedSeq = s;
      a.queue.push(s, steps[i]!, steps[i + 1]!, steps[i + 2]!, steps[i + 3]!, rt);
    }
    const max = NET.MAX_INPUT_QUEUE * Q;
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

  /** Spawn-screen choice: zone, class and whether the player pressed Deploy. */
  setSpawn(id: number, zone: number, classId: ClassId, ready: boolean): void {
    const a = this.actors.get(id);
    if (!a) return;
    if (zone >= -1 && zone < this.map.zones.length) a.spawnZone = zone;
    if (CLASS_IDS.includes(classId)) a.nextClass = classId;
    a.ready = ready;
  }

  /** Back-compat helper used by tests. */
  setSpawnZone(id: number, zone: number): void {
    const a = this.actors.get(id);
    if (a && zone >= -1 && zone < this.map.zones.length) a.spawnZone = zone;
  }

  /** At the start of LIVE everybody deploys with their current choice. */
  readyAll(): void {
    for (const a of this.actors.values()) {
      a.ready = true;
      a.respawnT = 0;
    }
  }

  /** Advance the match. When `live` is false (countdown/ending) inputs are acknowledged but not simulated. */
  step(dt: number, live: boolean): void {
    this.tick++;
    if (!live) {
      for (const a of this.actors.values()) this.drainInputs(a);
      return;
    }
    this.elapsedS += dt;

    for (const v of this.vehicles.values()) v.driven = 0;
    for (const a of this.actors.values()) {
      if (!a.alive) {
        this.drainInputs(a);
        continue;
      }
      const backlog = a.queue.length / Q;
      const n = Math.min(backlog, backlog > NET.INPUT_BACKLOG_CATCHUP ? NET.MAX_STEPS_PER_TICK_CATCHUP : NET.STEPS_PER_TICK);
      for (let i = 0; i < n && a.alive && a.queue.length >= Q; i++) {
        const seq = a.queue[0]!;
        const buttons = a.queue[1]!;
        const yaw = a.queue[2]!;
        const pitch = a.queue[3]!;
        const slot = a.queue[4]!;
        a.rt = a.queue[5]!;
        a.queue.splice(0, Q);
        a.ackSeq = seq;
        // Enter/exit: hold the use key (GAME.md 6).
        if ((buttons & BTN.USE) !== 0) {
          a.useT += NET.MOVE_DT;
          if (a.useT >= VEHICLE_RULES.enterHoldS && !a.useLatch) {
            a.useLatch = true;
            if (a.vehicle >= 0) this.leaveVehicle(a, true);
            else this.tryEnterVehicle(a);
          }
        } else {
          a.useT = 0;
          a.useLatch = false;
        }
        const v = a.vehicle >= 0 ? this.vehicles.get(a.vehicle) : undefined;
        if (v) {
          a.st.yaw = yaw;
          a.st.pitch = pitch;
          if (a.seat === 0) {
            const vact = stepVehicle(this.world, v.st, buttons, yaw, pitch, NET.MOVE_DT, true, this.vscratch);
            v.driven++;
            if (vact & VACT_CANNON) this.fireCannon(a, v);
            if (vact & VACT_MG) this.fireCoax(a, v);
          } else {
            const act = stepInventory(a.st, buttons & ~(BTN.GRENADE | BTN.GADGET_A), slot, NET.MOVE_DT);
            if (act === ACT_SHOOT && this.inPassengerArc(a, v)) this.fire(a);
          }
          this.placeInSeat(a, v);
          continue;
        }
        stepMovement(this.world, a.st, buttons, yaw, pitch, CLASSES[a.st.classId].speedMult, NET.MOVE_DT, this.scratch);
        const act = stepInventory(a.st, buttons, slot, NET.MOVE_DT);
        if (act !== 0) this.act(a, act);
      }
    }
    this.stepVehicles(dt);
    this.recordHistory();

    const sub = NET.MOVE_DT;
    for (let t = 0; t < dt - 1e-9; t += sub) this.stepProjectiles(Math.min(sub, dt - t));
    this.stepDeployables(dt);
    this.stepHealth(dt);
    this.stepZones(dt);
    this.stepResupply(dt);
    this.stepPads(dt);
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
      a.ackSeq = a.queue[a.queue.length - Q]!;
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

  // ---- Actions -----------------------------------------------------------

  private act(a: Actor, act: number): void {
    const st = a.st;
    const ox = st.x;
    const oy = st.y + eyeHeight(st);
    const oz = st.z;
    if (act === ACT_SHOOT || act === ACT_ROCKET || act === ACT_GRENADE) a.protectT = 0;
    if (act === ACT_SHOOT) {
      this.fire(a);
    } else if (act === ACT_ROCKET) {
      const d = aimDir(st.yaw, st.pitch, this.dir);
      applySpread(d, spreadDeg(st), this.rand(), this.rand());
      const v = GADGETS.rocket.speed;
      this.spawnProjectile(a, PROJ_ROCKET, ox + d.x * 0.6, oy + d.y * 0.6 - 0.1, oz + d.z * 0.6, d.x * v, d.y * v, d.z * v);
    } else if (act === ACT_GRENADE) {
      const d = aimDir(st.yaw, Math.min(1.4, st.pitch + GADGETS.grenade.throwLift), this.dir);
      const v = GADGETS.grenade.throwSpeed;
      this.spawnProjectile(a, PROJ_GRENADE, ox + d.x * 0.4, oy + d.y * 0.4, oz + d.z * 0.4, d.x * v + st.vx * 0.5, d.y * v, d.z * v + st.vz * 0.5);
    } else if (act === ACT_MEDPACK || act === ACT_AMMOBOX) {
      const kind = act === ACT_MEDPACK ? DEP_MEDPACK : DEP_AMMOBOX;
      const d = aimDir(st.yaw, 0, this.dir);
      const x = st.x + d.x * GADGETS.deployForward;
      const z = st.z + d.z * GADGETS.deployForward;
      const y = st.onGround ? Math.max(st.y, this.world.terrain.heightAt(x, z)) : this.world.terrain.heightAt(x, z);
      for (let i = this.deployables.length - 1; i >= 0; i--) {
        const dp = this.deployables[i]!;
        if (dp.owner === a.id && dp.kind === kind) this.deployables.splice(i, 1);
      }
      const dur = kind === DEP_MEDPACK ? GADGETS.medpack.durationS : GADGETS.ammobox.durationS;
      this.deployables.push({ id: this.nextEntityId++, kind, owner: a.id, team: a.team, x, y, z, t: dur });
    }
    if (act === ACT_TORCH) {
      // Repair torch: friendly (or empty) vehicles within reach of the nozzle (GAME.md 5.2).
      const d = aimDir(st.yaw, st.pitch, this.dir);
      const px = ox + d.x;
      const py = oy + d.y;
      const pz = oz + d.z;
      for (const v of this.vehicles.values()) {
        if (v.destroyed || (v.team >= 0 && v.team !== a.team)) continue;
        if (distToVehicle(v.st, px, py, pz) <= GADGETS.torch.range) {
          v.hp = Math.min(VEHICLES[v.kind].hp, v.hp + GADGETS.torch.repairPerS * NET.MOVE_DT);
        }
      }
    }
  }

  private spawnProjectile(a: Actor, kind: number, x: number, y: number, z: number, vx: number, vy: number, vz: number): void {
    this.projectiles.push({ id: this.nextEntityId++, kind, owner: a.id, team: a.team, x, y, z, vx, vy, vz, age: 0, resting: false });
  }

  private fire(a: Actor): void {
    const w = currentWeapon(a.st);
    if (!w) return;
    const ox = a.st.x;
    const oy = a.st.y + eyeHeight(a.st);
    const oz = a.st.z;
    const d = aimDir(a.st.yaw, a.st.pitch, this.dir);
    applySpread(d, spreadDeg(a.st), this.rand(), this.rand());
    this.hitscan(a, w, ox, oy, oz, d);
  }

  /** Remember where every actor is this tick (lag compensation, GAME.md M6). */
  private recordHistory(): void {
    const t = this.tick * TICK_MS;
    for (const a of this.actors.values()) {
      const i = ((a.histHead + a.histN) % HIST) * 5;
      if (a.histN === HIST) a.histHead = (a.histHead + 1) % HIST;
      else a.histN++;
      a.hist[i] = t;
      a.hist[i + 1] = a.st.x;
      a.hist[i + 2] = a.st.y;
      a.hist[i + 3] = a.st.z;
      a.hist[i + 4] = a.st.crouched ? 1 : 0;
    }
  }

  /**
   * Where `b` was at server time `t` (interpolated between recorded ticks); the current
   * position when `t` is newer than the history or no history exists.
   */
  rewound(b: Actor, t: number, out: { x: number; y: number; z: number; crouched: boolean }): typeof out {
    out.x = b.st.x;
    out.y = b.st.y;
    out.z = b.st.z;
    out.crouched = b.st.crouched;
    if (b.histN === 0) return out;
    const at = (k: number): number => ((b.histHead + k) % HIST) * 5;
    const newest = at(b.histN - 1);
    if (t >= b.hist[newest]!) return out;
    let prev = at(0);
    if (t <= b.hist[prev]!) {
      out.x = b.hist[prev + 1]!;
      out.y = b.hist[prev + 2]!;
      out.z = b.hist[prev + 3]!;
      out.crouched = b.hist[prev + 4] === 1;
      return out;
    }
    for (let k = 1; k < b.histN; k++) {
      const cur = at(k);
      const t1 = b.hist[cur]!;
      if (t <= t1) {
        const t0 = b.hist[prev]!;
        const f = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
        out.x = b.hist[prev + 1]! + (b.hist[cur + 1]! - b.hist[prev + 1]!) * f;
        out.y = b.hist[prev + 2]! + (b.hist[cur + 2]! - b.hist[prev + 2]!) * f;
        out.z = b.hist[prev + 3]! + (b.hist[cur + 3]! - b.hist[prev + 3]!) * f;
        out.crouched = (f < 0.5 ? b.hist[prev + 4] : b.hist[cur + 4]) === 1;
        return out;
      }
      prev = cur;
    }
    return out;
  }

  private readonly rw = { x: 0, y: 0, z: 0, crouched: false };

  /** Resolve a hitscan shot from (o) along normalised d against world, vehicles and actors. */
  private hitscan(a: Actor, w: WeaponDef, ox: number, oy: number, oz: number, d: Vec3): void {
    // Lag compensation: humans hit what they saw (targets rewound to their view time, capped).
    const now = this.tick * TICK_MS;
    const viewT = !a.bot && a.rt > 0 ? Math.max(now - NET.LAG_COMP_MAX_MS, Math.min(now, a.rt)) : now;
    const tStatic = this.world.raycastStatic(ox, oy, oz, d.x, d.y, d.z, w.rangeM);
    let best = tStatic;
    let target: Actor | null = null;
    let kind = HIT_NONE;
    let vtarget: Vehicle | null = null;
    for (const v of this.vehicles.values()) {
      if (v.destroyed || v.id === a.vehicle) continue;
      const t = rayVehicle(v.st, ox, oy, oz, d.x, d.y, d.z);
      if (t < best) {
        best = t;
        vtarget = v;
      }
    }
    for (const b of this.actors.values()) {
      if (b === a || !b.alive || b.team === a.team || this.protectedInVehicle(b)) continue;
      const p = this.rewound(b, viewT, this.rw);
      const t = rayActor(ox, oy, oz, d.x, d.y, d.z, p.x, p.y, p.z, p.crouched, this.hitOut);
      if (t < best) {
        best = t;
        target = b;
        kind = this.hitOut.kind;
        vtarget = null;
      }
    }
    const len = best === Infinity ? w.rangeM : best;
    const shotKind = target ? (kind === HIT_HEAD ? SHOT_HEAD : SHOT_BODY) : best === Infinity ? SHOT_NONE : SHOT_WORLD;
    this.shots.push(a.id, r2(ox + d.x * len), r2(oy + d.y * len), r2(oz + d.z * len), shotKind, widx(w.id));
    if (vtarget) {
      if (vtarget.team !== a.team) this.damageVehicle(vtarget, a, w.damageBody * w.vehicleDamageMult * falloffMult(w, best), widx(w.id));
      return;
    }
    if (!target) return;
    const head = kind === HIT_HEAD;
    const dmg = Math.round((head ? w.damageHead : w.damageBody) * falloffMult(w, best));
    this.applyDamage(target, a, dmg, head, widx(w.id));
  }

  /** Apply damage from `src` (null = environment). `w` is the kill-feed weapon code. */
  applyDamage(target: Actor, src: Actor | null, dmg: number, head: boolean, w = W_ENV): void {
    if (!target.alive || target.protectT > 0 || dmg <= 0) return;
    target.hp -= dmg;
    target.sinceDamage = 0;
    const kill = target.hp <= 0;
    if (src) {
      this.pushPrivate(src.id, { k: 'hit', target: target.id, dmg: Math.round(dmg), head, kill });
      this.pushPrivate(target.id, { k: 'dmg', from: src.id, x: r2(src.st.x), z: r2(src.st.z), dmg: Math.round(dmg) });
    }
    if (kill) this.kill(target, src, head, w);
  }

  private kill(target: Actor, src: Actor | null, head: boolean, w: number): void {
    this.leaveVehicle(target, false);
    target.hp = 0;
    target.alive = false;
    target.respawnT = MATCH.respawnS;
    target.deadT = 0;
    target.ready = false;
    target.deaths++;
    target.queue.length = 0;
    target.st.vx = 0;
    target.st.vz = 0;
    if (src && src !== target) src.kills++;
    this.broadcastEvents.push({ k: 'kill', killer: src ? src.id : -1, victim: target.id, head, w });
  }

  // ---- Projectiles, explosions, deployables --------------------------------

  private stepProjectiles(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]!;
      let direct: Actor | null = null;
      if (p.kind === PROJ_ROCKET || p.kind === PROJ_SHELL) {
        // Direct hits on enemies along this step's segment.
        const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz);
        const dist = speed * dt;
        const dx = p.vx / speed;
        const dy = p.vy / speed;
        const dz = p.vz / speed;
        const tStatic = this.world.raycastStatic(p.x, p.y, p.z, dx, dy, dz, dist);
        let best = Math.min(dist, tStatic);
        let vdirect: Vehicle | null = null;
        const ownVehicle = this.actors.get(p.owner)?.vehicle ?? -1;
        for (const v of this.vehicles.values()) {
          if (v.destroyed || v.id === ownVehicle) continue;
          const t = rayVehicle(v.st, p.x, p.y, p.z, dx, dy, dz);
          if (t <= best) {
            best = t;
            vdirect = v;
          }
        }
        if (vdirect) {
          p.x += dx * best;
          p.y += dy * best;
          p.z += dz * best;
          this.explode(p, null, vdirect);
          this.projectiles.splice(i, 1);
          continue;
        }
        for (const b of this.actors.values()) {
          if (!b.alive || b.team === p.team || this.protectedInVehicle(b)) continue;
          const t = rayActor(p.x, p.y, p.z, dx, dy, dz, b.st.x, b.st.y, b.st.z, b.st.crouched, this.hitOut);
          if (t <= best) {
            best = t;
            direct = b;
          }
        }
        if (direct) {
          p.x += dx * best;
          p.y += dy * best;
          p.z += dz * best;
          this.explode(p, direct);
          this.projectiles.splice(i, 1);
          continue;
        }
      }
      stepProjectile(this.world, p, dt, this.projOut);
      if (this.projOut.exploded) {
        this.explode(p, null);
        this.projectiles.splice(i, 1);
      }
    }
  }

  private explode(p: Projectile, direct: Actor | null, vdirect: Vehicle | null = null): void {
    const grenade = p.kind === PROJ_GRENADE;
    const shell = p.kind === PROJ_SHELL;
    const radius = grenade ? GADGETS.grenade.radius : shell ? TANK.cannon.splashRadius : GADGETS.rocket.splashRadius;
    const maxDmg = grenade ? GADGETS.grenade.damage : shell ? TANK.cannon.damageInfantry : GADGETS.rocket.splashDamage;
    const vehDmg = grenade ? GADGETS.grenade.damage * GADGETS.grenade.vehicleDamageMult : shell ? TANK.cannon.damageVehicle : GADGETS.rocket.vehicleDamage;
    const src = this.actors.get(p.owner) ?? null;
    const w = grenade ? W_GRENADE : shell ? widx('cannon') : widx('rocket');
    this.broadcastEvents.push({ k: 'boom', x: r2(p.x), y: r2(p.y), z: r2(p.z), r: radius, kind: p.kind });
    // Vehicles: full damage on a direct hit, linear falloff to the radius otherwise.
    for (const v of this.vehicles.values()) {
      if (v.destroyed || (v.team >= 0 && v.team === p.team)) continue;
      const dist = v === vdirect ? 0 : distToVehicle(v.st, p.x, p.y, p.z);
      const dmg = splashDamage(vehDmg, radius, dist);
      if (dmg > 0) this.damageVehicle(v, src, dmg, w);
    }
    for (const b of this.actors.values()) {
      // Friendly fire is always off (GAME.md 4.1); the thrower is not hurt either (DECISIONS.md).
      if (!b.alive || b.team === p.team || this.protectedInVehicle(b)) continue;
      const cy = b.st.y + (b.st.crouched ? 0.6 : 0.9);
      const dx = b.st.x - p.x;
      const dy = cy - p.y;
      const dz = b.st.z - p.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      let dmg = 0;
      if (dist < radius) {
        // Line of sight from slightly in front of the impact surface (back along the flight path),
        // so the wall that was hit does not shield everyone standing next to it.
        const sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz);
        const lx = sp > 1e-3 ? p.x - (p.vx / sp) * 0.3 : p.x;
        const ly = (sp > 1e-3 ? p.y - (p.vy / sp) * 0.3 : p.y) + 0.15;
        const lz = sp > 1e-3 ? p.z - (p.vz / sp) * 0.3 : p.z;
        const ldx = b.st.x - lx;
        const ldy = cy - ly;
        const ldz = b.st.z - lz;
        const ll = Math.sqrt(ldx * ldx + ldy * ldy + ldz * ldz);
        const blocked = ll > 0.3 && this.world.raycastStatic(lx, ly, lz, ldx / ll, ldy / ll, ldz / ll, ll) < ll - 0.3;
        if (!blocked) dmg = splashDamage(maxDmg, radius, dist);
      }
      // A direct rocket hit deals the direct damage plus full splash (60 + 40 = 100).
      if (b === direct && p.kind === PROJ_ROCKET) dmg = WEAPONS.rocket.damageBody + GADGETS.rocket.splashDamage;
      if (b === direct && shell) dmg = TANK.cannon.damageInfantry;
      if (dmg > 0) this.applyDamage(b, src, Math.round(dmg), false, w);
    }
  }

  private stepDeployables(dt: number): void {
    for (let i = this.deployables.length - 1; i >= 0; i--) {
      const d = this.deployables[i]!;
      d.t -= dt;
      if (d.t <= 0) {
        this.deployables.splice(i, 1);
        continue;
      }
      const r = d.kind === DEP_MEDPACK ? GADGETS.medpack.radius : GADGETS.ammobox.radius;
      for (const a of this.actors.values()) {
        if (!a.alive || a.team !== d.team) continue;
        const dx = a.st.x - d.x;
        const dz = a.st.z - d.z;
        if (dx * dx + dz * dz > r * r || Math.abs(a.st.y - d.y) > 2.5) continue;
        if (d.kind === DEP_MEDPACK) a.hp = Math.min(a.maxHp, a.hp + GADGETS.medpack.healPerS * dt);
        else refillAmmo(a.st, (GADGETS.ammobox.refillPctPerS / 100) * dt, a.ammoAcc);
      }
    }
  }

  /** Owned, non-contested zones heal and resupply friendly infantry near the station (GAME.md 4.6). */
  private stepResupply(dt: number): void {
    const rr = RESUPPLY.radius * RESUPPLY.radius;
    for (let zi = 0; zi < this.zones.length; zi++) {
      const z = this.zones[zi]!;
      if (z.owner < 0 || z.contested) continue;
      const pad = this.map.zones[zi]!.resupply;
      for (const a of this.actors.values()) {
        if (!a.alive || a.team !== z.owner) continue;
        const dx = a.st.x - pad.x;
        const dz = a.st.z - pad.z;
        if (dx * dx + dz * dz > rr) continue;
        a.hp = Math.min(a.maxHp, a.hp + RESUPPLY.healPerS * dt);
        refillAmmo(a.st, (RESUPPLY.ammoPctPerS / 100) * dt, a.ammoAcc);
      }
      for (const v of this.vehicles.values()) {
        if (v.destroyed || (v.team >= 0 && v.team !== z.owner)) continue;
        const dx = v.st.x - pad.x;
        const dz = v.st.z - pad.z;
        if (dx * dx + dz * dz <= rr) v.hp = Math.min(VEHICLES[v.kind].hp, v.hp + RESUPPLY.vehicleRepairPerS * dt);
      }
    }
  }

  // ---- Health, zones, respawns ---------------------------------------------

  private stepHealth(dt: number): void {
    const R = this.map.radius;
    for (const a of this.actors.values()) {
      if (a.ramT > 0) a.ramT -= dt;
      if (!a.alive) continue;
      if (a.protectT > 0) a.protectT = Math.max(0, a.protectT - dt);
      a.sinceDamage += dt;
      if (a.sinceDamage >= MATCH.regenDelayS && a.hp < a.maxHp) a.hp = Math.min(a.maxHp, a.hp + MATCH.regenPerS * dt);
      const r = Math.sqrt(a.st.x * a.st.x + a.st.z * a.st.z);
      if (r > R) {
        a.oobT += dt;
        if (a.oobT > MATCH.oobGraceS) {
          a.hp -= MATCH.oobDamagePerS * dt;
          if (a.hp <= 0) this.kill(a, null, false, W_ENV);
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
      const ownerBefore = z.owner;
      stepZone(z, this.present, dt, this.capEv);
      // "Zone under attack": the owner's control is being drained by enemies alone.
      if (ownerBefore >= 0 && !z.contested && this.present[ownerBefore] === 0 && this.present.some((n) => n > 0) && z.control[ownerBefore]! < 100) {
        if (this.elapsedS - this.lastAttack[zi]! >= MATCH.attackAnnounceS) {
          this.lastAttack[zi] = this.elapsedS;
          this.broadcastEvents.push({ k: 'attack', zone: zi, team: ownerBefore });
        }
      }
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
      a.deadT += dt;
      if (a.respawnT > 0) a.respawnT = Math.max(0, a.respawnT - dt);
      if (a.respawnT > 0 || this.teamStatus[a.team]?.eliminated) continue;
      if (!a.ready && a.deadT < MATCH.respawnS + MATCH.autoDeployS) continue;
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
    a.classId = a.nextClass;
    const cls = CLASSES[a.classId];
    copyPlayerState(a.st, createPlayerState(a.classId));
    loadout(a.st, a.classId);
    a.st.x = sp.x;
    a.st.y = sp.y;
    a.st.z = sp.z;
    a.st.yaw = sp.yaw;
    a.hp = cls.hp;
    a.maxHp = cls.hp;
    a.alive = true;
    a.ready = false;
    a.protectT = MATCH.spawnProtectionS;
    a.sinceDamage = 0;
    a.oobT = 0;
    a.respawnT = 0;
    a.ammoAcc.fill(0);
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
      out.push(a.id, r2(s.x), r2(s.y), r2(s.z), r3(s.yaw), r3(s.pitch), f, r2(Math.sqrt(s.vx * s.vx + s.vz * s.vz)), CLASS_IDS.indexOf(a.classId), s.slot);
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

  projectileArray(): number[] {
    const out: number[] = [];
    for (const p of this.projectiles) out.push(p.id, p.kind, r2(p.x), r2(p.y), r2(p.z));
    return out;
  }

  deployableArray(): number[] {
    const out: number[] = [];
    for (const d of this.deployables) out.push(d.id, d.kind, d.team, r2(d.x), r2(d.y), r2(d.z));
    return out;
  }

  vehicleArray(): number[] {
    const out: number[] = [];
    for (const v of this.vehicles.values()) {
      const s = v.st;
      out.push(
        v.id,
        VEHICLE_KINDS.indexOf(v.kind),
        v.team,
        r2(s.x),
        r2(s.y),
        r2(s.z),
        r3(s.yaw),
        r3(s.pitch),
        r3(s.roll),
        r3(s.turretYaw),
        r3(s.turretPitch),
        Math.ceil(v.hp),
        v.destroyed ? VF_DESTROYED : 0,
        v.seats[0] ?? -1,
        v.seats[1] ?? -1,
        r2(s.speed),
      );
    }
    if (out.length % VEH_FIELDS !== 0) throw new Error('vehicle field mismatch');
    return out;
  }

  totalControl(): number[] {
    const o = this.zones[0]?.owner ?? -1;
    if (o < 0 || !this.zones.every((z) => z.owner === o)) return [];
    return [o, Math.round(this.totalControlS * 10) / 10];
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
      veh: a.vehicle >= 0 ? { id: a.vehicle, seat: a.seat, vs: a.seat === 0 ? (this.vehicles.get(a.vehicle)?.st ?? null) : null } : null,
    };
  }

  boardRows(ping: (id: number) => number): BoardRow[] {
    return [...this.actors.values()].map((a) => ({ id: a.id, kills: a.kills, deaths: a.deaths, caps: a.caps, ping: ping(a.id) }));
  }

  // ---- Vehicles (GAME.md 6) -------------------------------------------------

  private protectedInVehicle(a: Actor): boolean {
    if (a.vehicle < 0) return false;
    const v = this.vehicles.get(a.vehicle);
    return !!v && !VEHICLES[v.kind].exposedOccupants;
  }

  private inPassengerArc(a: Actor, v: Vehicle): boolean {
    const rel = Math.abs(wrapAngle(a.st.yaw - v.st.yaw));
    return rel <= (VEHICLE_RULES.passengerArcDeg * Math.PI) / 180;
  }

  /** Occupants sit (crouched hitbox) with their eyes at the seat position. */
  private placeInSeat(a: Actor, v: Vehicle): void {
    const seat = VEHICLES[v.kind].seatOffsets[a.seat]!;
    vehiclePoint(v.st, seat.x, seat.y, seat.f, this.tmpP);
    a.st.x = this.tmpP.x;
    a.st.y = this.tmpP.y - MOVEMENT.crouchEyeHeight;
    a.st.z = this.tmpP.z;
    a.st.vx = 0;
    a.st.vy = 0;
    a.st.vz = 0;
    a.st.crouched = true;
    a.st.sprinting = false;
    a.st.onGround = true;
    if (a.seat === 0) a.st.ads = false;
  }

  private tryEnterVehicle(a: Actor): void {
    let best: Vehicle | null = null;
    let bestD: number = VEHICLE_RULES.enterRange;
    for (const v of this.vehicles.values()) {
      if (v.destroyed || (v.team >= 0 && v.team !== a.team)) continue;
      if (!v.seats.some((s) => s < 0)) continue;
      const d = distToVehicle(v.st, a.st.x, a.st.y + 1, a.st.z);
      if (d <= bestD) {
        bestD = d;
        best = v;
      }
    }
    if (!best) return;
    const seat = best.seats[0]! < 0 ? 0 : best.seats.indexOf(-1);
    best.seats[seat] = a.id;
    a.vehicle = best.id;
    a.seat = seat;
    a.st.reloadT = 0;
    best.team = a.team;
    best.emptyT = 0;
    this.placeInSeat(a, best);
  }

  /** Leave the current vehicle; `alive` = a normal exit (find a spot, fall damage). */
  leaveVehicle(a: Actor, alive: boolean): void {
    if (a.vehicle < 0) return;
    const v = this.vehicles.get(a.vehicle);
    const seat = a.seat;
    a.vehicle = -1;
    a.seat = -1;
    a.st.crouched = false;
    if (!v) return;
    v.seats[seat] = -1;
    this.updateVehicleTeam(v);
    if (!alive) return;
    const def = VEHICLES[v.kind];
    const side = seat === 1 ? 1 : -1;
    const candidates = [
      [side * (def.halfWidth + 0.9), 0],
      [-side * (def.halfWidth + 0.9), 0],
      [0, -(def.halfLength + 1)],
      [0, def.halfLength + 1],
    ];
    let placed = false;
    for (const [lx, lf] of candidates) {
      vehiclePoint(v.st, lx!, 0, lf!, this.tmpP);
      const y = this.world.terrain.heightAt(this.tmpP.x, this.tmpP.z);
      if (standingClear(this.world, this.tmpP.x, y, this.tmpP.z, this.scratch)) {
        a.st.x = this.tmpP.x;
        a.st.y = Math.max(y, v.st.y) + 0.1;
        a.st.z = this.tmpP.z;
        placed = true;
        break;
      }
    }
    if (!placed) a.st.y = v.st.y + def.height + 0.2;
    a.st.onGround = false;
    const speed = Math.abs(v.st.speed);
    a.st.vx = -Math.sin(v.st.yaw) * v.st.speed * 0.5;
    a.st.vz = -Math.cos(v.st.yaw) * v.st.speed * 0.5;
    if (speed > VEHICLE_RULES.exitSafeSpeed) this.applyDamage(a, null, (speed - VEHICLE_RULES.exitSafeSpeed) * VEHICLE_RULES.exitDamagePerMs, false);
  }

  private updateVehicleTeam(v: Vehicle): void {
    let team = -1;
    for (let i = v.seats.length - 1; i >= 0; i--) {
      const a = this.actors.get(v.seats[i]!);
      if (a) team = a.team;
    }
    v.team = team;
  }

  private fireCannon(a: Actor, v: Vehicle): void {
    const st = v.st;
    const d = aimDir(st.turretYaw, st.turretPitch, this.dir);
    const ox = st.x + d.x * TANK.barrelLength;
    const oy = st.y + TANK.turretY + d.y * TANK.barrelLength;
    const oz = st.z + d.z * TANK.barrelLength;
    const sp = TANK.cannon.speed;
    this.projectiles.push({ id: this.nextEntityId++, kind: PROJ_SHELL, owner: a.id, team: a.team, x: ox, y: oy, z: oz, vx: d.x * sp, vy: d.y * sp, vz: d.z * sp, age: 0, resting: false });
    a.protectT = 0;
  }

  private fireCoax(a: Actor, v: Vehicle): void {
    const st = v.st;
    const w = WEAPONS.coax;
    const d = aimDir(st.turretYaw, st.turretPitch, this.dir);
    applySpread(d, w.spreadHipDeg, this.rand(), this.rand());
    const ox = st.x + d.x * 1.5;
    const oy = st.y + TANK.turretY + 0.1;
    const oz = st.z + d.z * 1.5;
    this.hitscan(a, w, ox, oy, oz, d);
    a.protectT = 0;
  }

  damageVehicle(v: Vehicle, src: Actor | null, dmg: number, w: number): void {
    if (v.destroyed || dmg <= 0) return;
    v.hp -= dmg;
    if (src) this.pushPrivate(src.id, { k: 'hit', target: -v.id, dmg: Math.round(dmg), head: false, kill: v.hp <= 0 });
    for (const id of v.seats) if (id >= 0) this.pushPrivate(id, { k: 'dmg', from: src ? src.id : -1, x: r2(src ? src.st.x : v.st.x), z: r2(src ? src.st.z : v.st.z), dmg: Math.round(dmg) });
    if (v.hp <= 0) this.destroyVehicle(v, src);
    void w;
  }

  private destroyVehicle(v: Vehicle, src: Actor | null): void {
    v.hp = 0;
    v.destroyed = true;
    v.wreckT = VEHICLE_RULES.wreckS;
    v.st.speed = 0;
    const pad = this.pads[v.pad];
    if (pad && pad.vehicle === v.id) {
      pad.vehicle = -1;
      pad.respawnT = VEHICLES[v.kind].respawnS;
    }
    const cx = v.st.x;
    const cy = v.st.y + 1;
    const cz = v.st.z;
    this.broadcastEvents.push({ k: 'boom', x: r2(cx), y: r2(cy), z: r2(cz), r: VEHICLE_RULES.explosionRadius, kind: BOOM_VEHICLE });
    // Occupants die with the vehicle.
    for (const id of [...v.seats]) {
      const a = this.actors.get(id);
      if (a && a.alive) this.kill(a, src && src !== a ? src : null, false, W_VEHICLE_BOOM);
    }
    v.seats.fill(-1);
    v.team = -1;
    // Explosion splash 6 m, 80 damage (enemies of the attacker only: friendly fire is off).
    for (const b of this.actors.values()) {
      if (!b.alive || (src && b.team === src.team) || this.protectedInVehicle(b)) continue;
      const dx = b.st.x - cx;
      const dy = b.st.y + 0.9 - cy;
      const dz = b.st.z - cz;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const dmg = splashDamage(VEHICLE_RULES.explosionDamage, VEHICLE_RULES.explosionRadius, dist);
      if (dmg > 0) this.applyDamage(b, src, Math.round(dmg), false, W_VEHICLE_BOOM);
    }
  }

  private spawnVehicle(pi: number): void {
    const pad = this.pads[pi]!;
    for (const v of this.vehicles.values()) {
      if (!v.destroyed && (v.st.x - pad.x) ** 2 + (v.st.z - pad.z) ** 2 < 25) return; // pad blocked
    }
    const st = createVehicleState(pad.kind, pad.x, pad.y, pad.z, pad.yaw);
    st.turretYaw = pad.yaw;
    const v: Vehicle = { id: this.nextEntityId++, kind: pad.kind, pad: pi, st, hp: VEHICLES[pad.kind].hp, team: -1, seats: new Array<number>(VEHICLES[pad.kind].seats).fill(-1), destroyed: false, wreckT: 0, emptyT: 0, driven: 0 };
    this.vehicles.set(v.id, v);
    pad.vehicle = v.id;
  }

  private removeVehicle(v: Vehicle): void {
    for (const id of v.seats) {
      const a = this.actors.get(id);
      if (a) this.leaveVehicle(a, true);
    }
    this.vehicles.delete(v.id);
    const pad = this.pads[v.pad];
    if (pad && pad.vehicle === v.id) pad.vehicle = -1;
  }

  /** Pads: vehicles appear only on pads of owned zones; abandoned vehicles return (GAME.md 6). */
  private stepPads(dt: number): void {
    this.pads.forEach((pad, pi) => {
      const owner = this.zones[pad.zone]!.owner;
      if (pad.vehicle < 0) {
        if (owner < 0) return;
        if (pad.respawnT > 0) pad.respawnT = Math.max(0, pad.respawnT - dt);
        if (pad.respawnT <= 0) this.spawnVehicle(pi);
        return;
      }
      const v = this.vehicles.get(pad.vehicle);
      if (!v) {
        pad.vehicle = -1;
        return;
      }
      const atPad = (v.st.x - pad.x) ** 2 + (v.st.z - pad.z) ** 2 < 9;
      const empty = v.seats.every((s) => s < 0);
      if (owner < 0 && empty && atPad) this.removeVehicle(v);
    });
    for (const v of [...this.vehicles.values()]) {
      if (v.destroyed) {
        v.wreckT -= dt;
        if (v.wreckT <= 0) this.vehicles.delete(v.id);
        continue;
      }
      const pad = this.pads[v.pad]!;
      const empty = v.seats.every((s) => s < 0);
      const away = (v.st.x - pad.x) ** 2 + (v.st.z - pad.z) ** 2 > 9;
      v.emptyT = empty && away ? v.emptyT + dt : 0;
      if (v.emptyT >= VEHICLE_RULES.abandonS) {
        // Abandoned: return to the pad (the pad respawns it right away).
        this.removeVehicle(v);
        pad.respawnT = 0;
      }
    }
  }

  /** Coast unoccupied vehicles, push infantry out, ram, separate vehicles. */
  private stepVehicles(dt: number): void {
    for (const v of this.vehicles.values()) {
      if (v.destroyed) continue;
      const steps = Math.round(dt / NET.MOVE_DT);
      for (let i = v.driven; i < steps; i++) stepVehicle(this.world, v.st, 0, v.st.turretYaw, v.st.turretPitch, NET.MOVE_DT, v.seats[0]! >= 0, this.vscratch);
      for (let i = 0; i < v.seats.length; i++) {
        const a = this.actors.get(v.seats[i]!);
        if (a) this.placeInSeat(a, v);
      }
      // Infantry cannot stand inside vehicles; fast vehicles ram enemies.
      const speed = Math.abs(v.st.speed);
      for (const a of this.actors.values()) {
        if (!a.alive || a.vehicle >= 0) continue;
        this.tmpP.x = a.st.x;
        this.tmpP.z = a.st.z;
        if (Math.abs(a.st.y - v.st.y) > VEHICLES[v.kind].height + 1) continue;
        if (!pushOutOfVehicle(v.st, this.tmpP, MOVEMENT.radius)) continue;
        a.st.x = this.tmpP.x;
        a.st.z = this.tmpP.z;
        if (speed > VEHICLE_RULES.ramMinSpeed && a.ramT <= 0 && a.team !== v.team) {
          a.ramT = 0.5;
          const driver = this.actors.get(v.seats[0]!) ?? null;
          this.applyDamage(a, driver, (speed - VEHICLE_RULES.ramMinSpeed) * VEHICLE_RULES.ramDamagePerMs, false, W_RAM);
        }
      }
    }
    // Vehicle-vehicle separation (server only).
    const list = [...this.vehicles.values()].filter((v) => !v.destroyed);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!.st;
        const b = list[j]!.st;
        const ra = VEHICLES[a.kind].halfLength * 0.8;
        const rb = VEHICLES[b.kind].halfLength * 0.8;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        const pen = ra + rb - d;
        if (pen > 0 && d > 1e-6) {
          a.x -= (dx / d) * pen * 0.5;
          a.z -= (dz / d) * pen * 0.5;
          b.x += (dx / d) * pen * 0.5;
          b.z += (dz / d) * pen * 0.5;
          a.speed *= 0.6;
          b.speed *= 0.6;
        }
      }
    }
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
