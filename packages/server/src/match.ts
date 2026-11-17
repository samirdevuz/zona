import {
  ACTOR_FIELDS,
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
  RESUPPLY,
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
  createZoneState,
  currentWeapon,
  eyeHeight,
  falloffMult,
  loadout,
  pickSpawnPoint,
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
  type WeaponId,
  type ZoneState,
} from '@zona/shared';

/** Queue entry size: seq, buttons, yaw, pitch, slot. */
const Q = 5;

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
  /** Last processed (acknowledged) input sequence number. */
  ackSeq: number;
  kills: number;
  deaths: number;
  caps: number;
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
    for (let i = this.deployables.length - 1; i >= 0; i--) if (this.deployables[i]!.owner === id) this.deployables.splice(i, 1);
  }

  /** Queue input steps (flat [buttons, yaw, pitch, slot] quads) starting at `seq`. */
  queueInput(id: number, seq: number, steps: number[]): void {
    const a = this.actors.get(id);
    if (!a) return;
    for (let i = 0; i + 3 < steps.length; i += 4) {
      const s = seq + i / 4;
      if (s <= a.lastQueuedSeq) continue;
      a.lastQueuedSeq = s;
      a.queue.push(s, steps[i]!, steps[i + 1]!, steps[i + 2]!, steps[i + 3]!);
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

    for (const a of this.actors.values()) {
      if (!a.alive) {
        this.drainInputs(a);
        continue;
      }
      const backlog = a.queue.length / Q;
      const n = Math.min(backlog, backlog > NET.INPUT_BACKLOG_CATCHUP ? NET.MAX_STEPS_PER_TICK_CATCHUP : NET.STEPS_PER_TICK);
      for (let i = 0; i < n && a.alive; i++) {
        const seq = a.queue[0]!;
        const buttons = a.queue[1]!;
        const yaw = a.queue[2]!;
        const pitch = a.queue[3]!;
        const slot = a.queue[4]!;
        a.queue.splice(0, Q);
        a.ackSeq = seq;
        stepMovement(this.world, a.st, buttons, yaw, pitch, CLASSES[a.st.classId].speedMult, NET.MOVE_DT, this.scratch);
        const act = stepInventory(a.st, buttons, slot, NET.MOVE_DT);
        if (act !== 0) this.act(a, act);
      }
    }

    const sub = NET.MOVE_DT;
    for (let t = 0; t < dt - 1e-9; t += sub) this.stepProjectiles(Math.min(sub, dt - t));
    this.stepDeployables(dt);
    this.stepHealth(dt);
    this.stepZones(dt);
    this.stepResupply(dt);
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
    // ACT_TORCH repairs vehicles (M3); nothing to repair yet.
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
    const tStatic = this.world.raycastStatic(ox, oy, oz, d.x, d.y, d.z, w.rangeM);
    let best = tStatic;
    let target: Actor | null = null;
    let kind = HIT_NONE;
    for (const b of this.actors.values()) {
      if (b === a || !b.alive || b.team === a.team) continue;
      const t = rayActor(ox, oy, oz, d.x, d.y, d.z, b.st.x, b.st.y, b.st.z, b.st.crouched, this.hitOut);
      if (t < best) {
        best = t;
        target = b;
        kind = this.hitOut.kind;
      }
    }
    const len = best === Infinity ? w.rangeM : best;
    const shotKind = target ? (kind === HIT_HEAD ? SHOT_HEAD : SHOT_BODY) : best === Infinity ? SHOT_NONE : SHOT_WORLD;
    this.shots.push(a.id, r2(ox + d.x * len), r2(oy + d.y * len), r2(oz + d.z * len), shotKind, widx(w.id));
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
      if (p.kind === PROJ_ROCKET) {
        // Direct hits on enemies along this step's segment.
        const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz);
        const dist = speed * dt;
        const dx = p.vx / speed;
        const dy = p.vy / speed;
        const dz = p.vz / speed;
        const tStatic = this.world.raycastStatic(p.x, p.y, p.z, dx, dy, dz, dist);
        let best = Math.min(dist, tStatic);
        for (const b of this.actors.values()) {
          if (!b.alive || b.team === p.team) continue;
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

  private explode(p: Projectile, direct: Actor | null): void {
    const grenade = p.kind === PROJ_GRENADE;
    const radius = grenade ? GADGETS.grenade.radius : GADGETS.rocket.splashRadius;
    const maxDmg = grenade ? GADGETS.grenade.damage : GADGETS.rocket.splashDamage;
    const src = this.actors.get(p.owner) ?? null;
    const w = grenade ? W_GRENADE : widx('rocket');
    this.broadcastEvents.push({ k: 'boom', x: r2(p.x), y: r2(p.y), z: r2(p.z), r: radius, kind: p.kind });
    for (const b of this.actors.values()) {
      // Friendly fire is always off (GAME.md 4.1); the thrower is not hurt either (DECISIONS.md).
      if (!b.alive || b.team === p.team) continue;
      const cy = b.st.y + (b.st.crouched ? 0.6 : 0.9);
      const dx = b.st.x - p.x;
      const dy = cy - p.y;
      const dz = b.st.z - p.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      let dmg = 0;
      if (dist < radius) {
        const ly = p.y + 0.15;
        const ldy = cy - ly;
        const ll = Math.sqrt(dx * dx + ldy * ldy + dz * dz);
        const blocked = ll > 0.3 && this.world.raycastStatic(p.x, ly, p.z, dx / ll, ldy / ll, dz / ll, ll) < ll - 0.3;
        if (!blocked) dmg = splashDamage(maxDmg, radius, dist);
      }
      // A direct rocket hit deals the direct damage plus full splash (60 + 40 = 100).
      if (b === direct && !grenade) dmg = WEAPONS.rocket.damageBody + GADGETS.rocket.splashDamage;
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
    }
  }

  // ---- Health, zones, respawns ---------------------------------------------

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
