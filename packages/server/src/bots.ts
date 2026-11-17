import {
  BOTS,
  BOT_DIFFICULTY,
  BTN,
  CLASS_IDS,
  DEG2RAD,
  NET,
  PathFinder,
  SHOT_FIELDS,
  VEHICLES,
  ZONES,
  buildNavGrid,
  canSpawnAt,
  currentWeapon,
  eyeHeight,
  spreadDeg,
  wrapAngle,
  type BotDifficulty,
  type ClassId,
} from '@zona/shared';
import type { Actor, Match } from './match';

/** Per-bot memory (GAME.md 9). Bots only ever produce InputSteps, like humans. */
interface Brain {
  id: number;
  seq: number;
  classId: ClassId;
  objective: number;
  goalX: number;
  goalZ: number;
  path: number[];
  pathIdx: number;
  needPath: boolean;
  pathQueued: boolean;
  nextDecision: number;
  perceiveT: number;
  target: number;
  visibleT: number;
  reaction: number;
  lastSeenX: number;
  lastSeenY: number;
  lastSeenZ: number;
  lastSeenT: number;
  errYaw: number;
  errPitch: number;
  burst: number;
  pause: number;
  strafe: number;
  strafeT: number;
  stuckT: number;
  stuckCount: number;
  lastX: number;
  lastZ: number;
  unstick: number;
  yaw: number;
  pitch: number;
  firePhase: boolean;
  wasAlive: boolean;
}

/** Recent gunfire, for hearing. */
interface Heard {
  shooter: number;
  x: number;
  z: number;
  t: number;
}

/**
 * Server-side bots: team strategy, A* navigation (time-sliced), perception
 * (view cone, line of sight, hearing) and combat (reaction, shrinking aim
 * error, bursts, strafing, reloads, retreat to resupply).
 */
export class BotController {
  readonly brains = new Map<number, Brain>();
  private readonly pf: PathFinder;
  private readonly pathQueue: number[] = [];
  private time = 0;
  private planT = 0;
  private readonly heard: Heard[] = [];
  private nameIdx = 0;
  private nextId = 10000;
  private readonly diff;

  constructor(
    private readonly m: Match,
    difficulty: BotDifficulty,
    private readonly rand: () => number,
  ) {
    this.pf = new PathFinder(buildNavGrid(m.world));
    this.diff = BOT_DIFFICULTY[difficulty];
    this.nameIdx = Math.floor(rand() * BOTS.names.length);
  }

  /** Composition balance: the class whose share is furthest below its weight (GAME.md 9). */
  private pickClass(team: number): ClassId {
    const counts: Record<ClassId, number> = { assault: 0, engineer: 0, gunner: 0, sniper: 0 };
    let n = 0;
    for (const a of this.m.actors.values()) {
      if (a.team !== team) continue;
      counts[this.brains.get(a.id)?.classId ?? a.classId]++;
      n++;
    }
    let best: ClassId = 'assault';
    let bestScore = -Infinity;
    for (const c of CLASS_IDS) {
      const score = BOTS.classWeights[c] * (n + 1) - counts[c];
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  }

  addBot(team: number, spawnNow = false): Actor {
    const id = this.nextId++;
    const name = BOTS.names[this.nameIdx++ % BOTS.names.length]!;
    const classId = this.pickClass(team);
    const a = this.m.addActor(id, name, team, { bot: true, spawnNow: false, classId });
    if (spawnNow) a.respawnT = 0;
    this.brains.set(id, {
      id,
      seq: 0,
      classId,
      objective: -1,
      goalX: 0,
      goalZ: 0,
      path: [],
      pathIdx: 0,
      needPath: false,
      pathQueued: false,
      nextDecision: 0,
      perceiveT: this.rand() / BOTS.perceptionHz,
      target: -1,
      visibleT: 0,
      reaction: 0,
      lastSeenX: 0,
      lastSeenY: 0,
      lastSeenZ: 0,
      lastSeenT: -Infinity,
      errYaw: 0,
      errPitch: 0,
      burst: 0,
      pause: 0,
      strafe: 1,
      strafeT: 0,
      stuckT: 0,
      stuckCount: 0,
      lastX: 0,
      lastZ: 0,
      unstick: 0,
      yaw: 0,
      pitch: 0,
      firePhase: false,
      wasAlive: false,
    });
    this.m.setSpawn(id, -1, classId, true);
    return a;
  }

  /** Remove one bot of a team (a human took the slot). Returns its id or -1. */
  removeBotFromTeam(team: number): number {
    let pick = -1;
    for (const b of this.brains.values()) {
      const a = this.m.actors.get(b.id);
      if (!a || a.team !== team) continue;
      if (pick < 0 || !a.alive) pick = b.id; // prefer a dead one
    }
    if (pick >= 0) this.removeBot(pick);
    return pick;
  }

  removeBot(id: number): void {
    this.brains.delete(id);
    this.m.removeActor(id);
  }

  countOnTeam(team: number): number {
    let n = 0;
    for (const a of this.m.actors.values()) if (a.team === team) n++;
    return n;
  }

  /** Record this tick's gunfire for hearing (call after the match step). */
  observe(shots: number[]): void {
    for (let i = 0; i + SHOT_FIELDS - 1 < shots.length; i += SHOT_FIELDS) {
      const shooter = this.m.actors.get(shots[i]!);
      if (shooter) this.heard.push({ shooter: shooter.id, x: shooter.st.x, z: shooter.st.z, t: this.time });
    }
    while (this.heard.length > 0 && this.time - this.heard[0]!.t > 1.5) this.heard.shift();
    if (this.heard.length > 64) this.heard.splice(0, this.heard.length - 64);
  }

  /** Produce this tick's input steps for every bot. Call before the match step. */
  update(dt: number, live: boolean): void {
    this.time += dt;
    if (!live) return;
    this.planT -= dt;
    if (this.planT <= 0) {
      this.planT = BOTS.teamPlanS;
      this.planTeams();
    }
    // Time-sliced path requests.
    for (let k = 0; k < BOTS.pathsPerTick && this.pathQueue.length > 0; k++) {
      const id = this.pathQueue.shift()!;
      const b = this.brains.get(id);
      const a = this.m.actors.get(id);
      if (!b || !a) continue;
      b.pathQueued = false;
      if (!a.alive) continue;
      if (!this.pf.find(a.st.x, a.st.z, b.goalX, b.goalZ, BOTS.maxPathNodes, b.path)) {
        b.path.length = 0;
        b.path.push(b.goalX, b.goalZ);
      }
      b.pathIdx = 0;
      b.needPath = false;
    }
    for (const b of this.brains.values()) {
      const a = this.m.actors.get(b.id);
      if (!a) continue;
      if (!a.alive) {
        b.wasAlive = false;
        b.target = -1;
        if (!a.ready) this.m.setSpawn(a.id, this.spawnZoneFor(a, b), b.classId, true);
        continue;
      }
      if (!b.wasAlive) {
        b.wasAlive = true;
        b.yaw = a.st.yaw;
        b.pitch = 0;
        b.needPath = true;
        b.nextDecision = 0;
        b.lastX = a.st.x;
        b.lastZ = a.st.z;
      }
      this.think(a, b, dt);
    }
  }

  // ---- Strategy ----------------------------------------------------------

  /** Team-level objective assignment so bots spread over zones (GAME.md 9). */
  private planTeams(): void {
    const m = this.m;
    for (let team = 0; team < m.teams; team++) {
      const pri = m.zones.map((z, zi) => {
        const enemiesNear = this.enemiesNearZone(zi, team);
        if (z.owner === team) {
          if (z.contested || z.control[team]! < 100 || enemiesNear > 0) return 1.5;
          return 0.15;
        }
        let p = 1.0;
        if (z.owner < 0) p += 0.3;
        if (z.contested) p += 0.2;
        return p;
      });
      const assigned = new Array<number>(m.zones.length).fill(0);
      const bots = [...this.brains.values()].filter((b) => m.actors.get(b.id)?.team === team);
      for (const b of bots) {
        const a = m.actors.get(b.id)!;
        let best = -1;
        let bestScore = -Infinity;
        m.map.zones.forEach((zd, zi) => {
          const z = m.zones[zi]!;
          const dist = Math.sqrt((zd.x - a.st.x) ** 2 + (zd.z - a.st.z) ** 2);
          let classMult = 1;
          const defend = z.owner === team;
          if (b.classId === 'gunner' && defend && pri[zi]! > 1) classMult = 1.3;
          if ((b.classId === 'assault' || b.classId === 'engineer') && !defend) classMult = 1.15;
          const score = (pri[zi]! * classMult) / (1 + dist / 150) - 0.35 * assigned[zi]! + this.rand() * 0.05;
          if (score > bestScore) {
            bestScore = score;
            best = zi;
          }
        });
        if (best >= 0) {
          assigned[best]!++;
          if (best !== b.objective) {
            b.objective = best;
            b.nextDecision = 0;
          }
        }
      }
    }
  }

  private enemiesNearZone(zi: number, team: number): number {
    const zd = this.m.map.zones[zi]!;
    let n = 0;
    for (const a of this.m.actors.values()) {
      if (!a.alive || a.team === team) continue;
      if ((a.st.x - zd.x) ** 2 + (a.st.z - zd.z) ** 2 < 40 * 40) n++;
    }
    return n;
  }

  private spawnZoneFor(a: Actor, b: Brain): number {
    const m = this.m;
    let best = -1;
    let bestD = Infinity;
    const obj = b.objective >= 0 ? m.map.zones[b.objective]! : null;
    m.zones.forEach((z, zi) => {
      if (!canSpawnAt(z, a.team)) return;
      const zd = m.map.zones[zi]!;
      const d = obj ? (zd.x - obj.x) ** 2 + (zd.z - obj.z) ** 2 : 0;
      if (d < bestD) {
        bestD = d;
        best = zi;
      }
    });
    return best;
  }

  /** Pick where to go: the assigned zone (or the resupply station when hurt). */
  private chooseGoal(a: Actor, b: Brain): void {
    const m = this.m;
    b.nextDecision = BOTS.decisionMinS + this.rand() * (BOTS.decisionMaxS - BOTS.decisionMinS);
    // Retreat to resupply when low on health and not fighting.
    if (a.hp < a.maxHp * BOTS.retreatHpFrac && b.target < 0) {
      let best = -1;
      let bestD = Infinity;
      m.zones.forEach((z, zi) => {
        if (z.owner !== a.team || z.contested) return;
        const p = m.map.zones[zi]!.resupply;
        const d = (p.x - a.st.x) ** 2 + (p.z - a.st.z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = zi;
        }
      });
      if (best >= 0) {
        const p = m.map.zones[best]!.resupply;
        this.setGoal(b, p.x + (this.rand() - 0.5) * 4, p.z + (this.rand() - 0.5) * 4);
        return;
      }
    }
    if (b.objective < 0) return;
    const zd = m.map.zones[b.objective]!;
    if (b.classId === 'sniper') {
      // Snipers hold back 25-40 m on their own side of the zone.
      const home = m.map.zones.find((z) => z.homeTeam === a.team) ?? zd;
      let dx = home.x - zd.x;
      let dz = home.z - zd.z;
      const l = Math.sqrt(dx * dx + dz * dz);
      if (l < 1) {
        dx = a.st.x - zd.x;
        dz = a.st.z - zd.z;
      }
      const ll = Math.sqrt(dx * dx + dz * dz) || 1;
      const r = BOTS.sniperHoldMinM + this.rand() * (BOTS.sniperHoldMaxM - BOTS.sniperHoldMinM);
      const side = (this.rand() - 0.5) * 0.9;
      const c = Math.cos(side);
      const s = Math.sin(side);
      const ux = (dx / ll) * c - (dz / ll) * s;
      const uz = (dx / ll) * s + (dz / ll) * c;
      this.setGoal(b, zd.x + ux * r, zd.z + uz * r);
      return;
    }
    const ang = this.rand() * Math.PI * 2;
    const rad = 2 + this.rand() * (ZONES.captureRadius - 6);
    this.setGoal(b, zd.x + Math.cos(ang) * rad, zd.z + Math.sin(ang) * rad);
  }

  private setGoal(b: Brain, x: number, z: number): void {
    if ((x - b.goalX) ** 2 + (z - b.goalZ) ** 2 < 4 && b.path.length > 0) return;
    b.goalX = x;
    b.goalZ = z;
    b.needPath = true;
  }

  // ---- Perception -----------------------------------------------------------

  private perceive(a: Actor, b: Brain): void {
    const m = this.m;
    const ex = a.st.x;
    const ey = a.st.y + eyeHeight(a.st);
    const ez = a.st.z;
    const halfCone = (BOTS.viewConeDeg / 2) * DEG2RAD;
    let best: Actor | null = null;
    let bestD = Infinity;
    const keep = b.target >= 0 ? m.actors.get(b.target) : undefined;
    for (const t of m.actors.values()) {
      if (!t.alive || t.team === a.team || this.inTank(t)) continue;
      const dx = t.st.x - ex;
      const dz = t.st.z - ez;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > BOTS.viewRangeM) continue;
      const yawTo = Math.atan2(-dx, -dz);
      const inCone = Math.abs(wrapAngle(yawTo - b.yaw)) <= halfCone || d < 6 || t === keep;
      if (!inCone) continue;
      const ty = t.st.y + (t.st.crouched ? 0.8 : 1.2);
      const dy = ty - ey;
      const dist3 = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (m.world.raycastStatic(ex, ey, ez, dx / dist3, dy / dist3, dz / dist3, dist3) < dist3 - 0.2) continue;
      const score = t === keep ? d * 0.7 : d;
      if (score < bestD) {
        bestD = score;
        best = t;
      }
    }
    if (best) {
      if (best.id !== b.target) {
        b.target = best.id;
        b.visibleT = 0;
        b.reaction = this.diff.reactionS * (0.85 + this.rand() * 0.3);
        const ang = this.rand() * Math.PI * 2;
        b.errYaw = Math.cos(ang);
        b.errPitch = Math.sin(ang) * 0.6;
      }
      b.lastSeenX = best.st.x;
      b.lastSeenY = best.st.y;
      b.lastSeenZ = best.st.z;
      b.lastSeenT = this.time;
      // The aim error wanders a little.
      b.errYaw += (this.rand() - 0.5) * 0.3;
      b.errPitch += (this.rand() - 0.5) * 0.2;
      const l = Math.sqrt(b.errYaw * b.errYaw + b.errPitch * b.errPitch) || 1;
      b.errYaw /= l;
      b.errPitch /= l;
    } else {
      if (b.target >= 0 && this.time - b.lastSeenT > 0.4) b.target = -1;
      // Hearing: turn towards nearby enemy gunfire.
      for (let i = this.heard.length - 1; i >= 0; i--) {
        const h = this.heard[i]!;
        const s = m.actors.get(h.shooter);
        if (!s || s.team === a.team) continue;
        if ((h.x - ex) ** 2 + (h.z - ez) ** 2 > BOTS.hearingRangeM * BOTS.hearingRangeM) continue;
        b.lastSeenX = h.x;
        b.lastSeenY = s.st.y;
        b.lastSeenZ = h.z;
        b.lastSeenT = Math.max(b.lastSeenT, h.t);
        break;
      }
    }
  }

  private inTank(a: Actor): boolean {
    if (a.vehicle < 0) return false;
    const v = this.m.vehicles.get(a.vehicle);
    return !!v && !VEHICLES[v.kind].exposedOccupants;
  }

  // ---- Behaviour -------------------------------------------------------------

  private think(a: Actor, b: Brain, dt: number): void {
    const m = this.m;
    b.perceiveT -= dt;
    if (b.perceiveT <= 0) {
      b.perceiveT += 1 / BOTS.perceptionHz;
      this.perceive(a, b);
    }
    b.nextDecision -= dt;
    if (b.nextDecision <= 0) this.chooseGoal(a, b);
    if (b.needPath && !b.pathQueued) {
      b.pathQueued = true;
      this.pathQueue.push(b.id);
    }

    const target = b.target >= 0 ? m.actors.get(b.target) : undefined;
    const engaging = !!target && target.alive;
    if (engaging) b.visibleT += dt;
    if (b.reaction > 0) b.reaction -= dt;
    const st = a.st;
    let buttons = 0;
    let slot = -1;
    let wantYaw = b.yaw;
    let wantPitch = 0;

    // Movement along the path.
    let moveYaw = NaN;
    let moving = false;
    const holdPosition = engaging && (b.classId === 'sniper' || b.classId === 'gunner');
    if (b.path.length > 0 && b.pathIdx < b.path.length) {
      const wx = b.path[b.pathIdx]!;
      const wz = b.path[b.pathIdx + 1]!;
      const dx = wx - st.x;
      const dz = wz - st.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < BOTS.waypointReachM) b.pathIdx += 2;
      else if (!holdPosition) {
        moveYaw = Math.atan2(-dx, -dz);
        moving = true;
      }
    }

    // Aim.
    let dist = 0;
    if (engaging) {
      const aimY = target.st.y + (target.st.crouched ? 0.75 : 1.1);
      const dx = target.st.x - st.x;
      const dy = aimY - (st.y + eyeHeight(st));
      const dz = target.st.z - st.z;
      dist = Math.sqrt(dx * dx + dz * dz);
      const floor = 0.3 * (1 - this.diff.accuracy) + 0.03;
      const err = this.diff.aimErrDeg * (floor + (1 - floor) * Math.pow(0.5, b.visibleT / BOTS.aimSettleS)) * DEG2RAD;
      wantYaw = Math.atan2(-dx, -dz) + b.errYaw * err;
      wantPitch = Math.atan2(dy, dist) + b.errPitch * err;
    } else if (this.time - b.lastSeenT < BOTS.memoryS) {
      wantYaw = Math.atan2(-(b.lastSeenX - st.x), -(b.lastSeenZ - st.z));
      wantPitch = 0;
    } else if (moving) {
      wantYaw = moveYaw;
      wantPitch = -0.05;
    }
    const maxTurn = this.diff.turnRateDeg * DEG2RAD * dt;
    const dyaw = wrapAngle(wantYaw - b.yaw);
    b.yaw = wrapAngle(b.yaw + Math.max(-maxTurn, Math.min(maxTurn, dyaw)));
    b.pitch += Math.max(-maxTurn, Math.min(maxTurn, wantPitch - b.pitch));
    b.pitch = Math.max(-1.4, Math.min(1.4, b.pitch));

    // Strafing while fighting (not snipers/gunners holding a spot).
    if (engaging && !holdPosition) {
      b.strafeT -= dt;
      if (b.strafeT <= 0) {
        b.strafe = -b.strafe;
        b.strafeT = BOTS.strafeMinS + this.rand() * (BOTS.strafeMaxS - BOTS.strafeMinS);
      }
      buttons |= b.strafe > 0 ? BTN.RIGHT : BTN.LEFT;
    }
    if (moving) {
      const rel = wrapAngle(moveYaw - b.yaw);
      const fwd = Math.cos(rel);
      const right = -Math.sin(rel);
      if (fwd > 0.38) buttons |= BTN.FORWARD;
      else if (fwd < -0.38) buttons |= BTN.BACK;
      if (!engaging) {
        if (right > 0.38) buttons |= BTN.RIGHT;
        else if (right < -0.38) buttons |= BTN.LEFT;
      }
      const remaining = b.path.length - b.pathIdx;
      if (!engaging && fwd > 0.9 && remaining > 2 && this.time - b.lastSeenT > 2 && a.hp > a.maxHp * 0.5) buttons |= BTN.SPRINT;
    }

    // Stuck detection: jump and strafe, then replan.
    b.stuckT += dt;
    if (b.stuckT >= BOTS.stuckCheckS) {
      const moved = Math.sqrt((st.x - b.lastX) ** 2 + (st.z - b.lastZ) ** 2);
      if (moving && moved < BOTS.stuckMoveM) {
        b.unstick = 0.6;
        b.stuckCount++;
        if (b.stuckCount >= 2) {
          b.stuckCount = 0;
          b.needPath = true;
          b.goalX += (this.rand() - 0.5) * 6;
          b.goalZ += (this.rand() - 0.5) * 6;
        }
      } else b.stuckCount = 0;
      b.stuckT = 0;
      b.lastX = st.x;
      b.lastZ = st.z;
    }
    if (b.unstick > 0) {
      b.unstick -= dt;
      buttons |= BTN.JUMP | (b.strafe > 0 ? BTN.RIGHT : BTN.LEFT) | BTN.FORWARD;
    }

    // Weapons.
    const w = currentWeapon(st);
    if (st.slot !== 0 && !(b.classId === 'engineer' && st.slot === 3)) slot = 0;
    if (engaging && w && b.reaction <= 0) {
      const aimOff = Math.abs(wrapAngle(wantYaw - b.yaw)) + Math.abs(wantPitch - b.pitch);
      const tolerance = Math.max(2.5 * DEG2RAD, spreadDeg(st) * DEG2RAD * 1.5 + 0.02);
      if (dist > 18 || b.classId === 'sniper') buttons |= BTN.ADS;
      if (holdPosition && dist > 20) buttons |= BTN.CROUCH;
      buttons &= ~BTN.SPRINT;
      if (aimOff < tolerance && st.mag[st.slot]! > 0 && st.reloadT <= 0) {
        if (w.automatic) {
          if (b.burst > 0) {
            buttons |= BTN.FIRE;
            b.burst -= dt;
            if (b.burst <= 0) b.pause = BOTS.burstPauseMinS + this.rand() * (BOTS.burstPauseMaxS - BOTS.burstPauseMinS);
          } else if (b.pause > 0) b.pause -= dt;
          else b.burst = BOTS.burstMinS + this.rand() * (BOTS.burstMaxS - BOTS.burstMinS) * (dist > 40 ? 0.6 : 1);
        } else {
          b.firePhase = !b.firePhase;
          if (b.firePhase && st.cooldown <= 0) buttons |= BTN.FIRE;
        }
      }
    }
    // Reload when out of the fight and low.
    if (w && !engaging && st.mag[st.slot]! <= Math.ceil(w.magSize * 0.3) && st.res[st.slot]! > 0) buttons |= BTN.RELOAD;
    // Gadgets: medic heals itself, the gunner drops ammo when holding a fight.
    if (st.gadgetCd <= 0) {
      if (b.classId === 'assault' && a.hp < a.maxHp * 0.55) buttons |= BTN.GADGET_A;
      if (b.classId === 'gunner' && engaging && dist < 35) buttons |= BTN.GADGET_A;
    }

    // Two steps per tick (60 Hz input like a client). Semi-auto fire releases on the second step.
    const steps = Math.max(1, Math.round(dt / NET.MOVE_DT));
    const out: number[] = [];
    for (let k = 0; k < steps; k++) {
      let bk = buttons;
      if (k > 0) bk &= ~(BTN.GADGET_A | BTN.GRENADE | (w && !w.automatic ? BTN.FIRE : 0));
      out.push(bk, b.yaw, b.pitch, k === 0 ? slot : -1);
    }
    m.queueInput(a.id, b.seq, out);
    b.seq += steps;
  }
}
