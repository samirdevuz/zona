import {
  MATCH,
  NET,
  PROTOCOL_VERSION,
  autoNeutrals,
  decodeMap,
  isAllowedCombo,
  encodeMap,
  encodeMsg,
  generateMap,
  parseClientMsg,
  seedFromString,
  type ActorInfo,
  type ClientMsg,
  type LobbyPlayer,
  type MatchSettings,
  type Phase,
  type ServerMsg,
} from '@zona/shared';
import { randomUUID } from 'node:crypto';
import { Match } from './match';

/** A connected client as seen by the session (socket abstraction for tests and the sim). */
export interface Conn {
  send(data: string): void;
  close(): void;
}

interface Player {
  id: number;
  name: string;
  token: string;
  team: number;
  /** Join order, used to pick the next admin. */
  order: number;
  conn: Conn | null;
  disconnectedAt: number;
  ping: number;
}

export interface SessionOptions {
  debug?: boolean;
  /** Seconds clock (injected for tests). */
  now?: () => number;
  log?: (msg: string) => void;
  rand?: () => number;
}

const DT = 1 / NET.SERVER_TICK_HZ;

/**
 * One lobby/match per server process (GAME.md 3.3 session model).
 * Owns players, phases and the Match; turns client messages into actions.
 */
export class Session {
  phase: Phase = 'lobby';
  phaseT = 0;
  match: Match | null = null;
  settings: MatchSettings = {
    teams: MATCH.defaultTeams,
    neutrals: 0,
    autoNeutrals: true,
    seed: '',
    scoreLimit: MATCH.defaultScoreLimit,
    timeLimitMin: MATCH.defaultTimeLimitMin,
    vehicles: true,
  };
  adminId = -1;
  readonly players = new Map<number, Player>();
  private readonly connPlayer = new Map<Conn, number>();
  private nextId = 1;
  private nextOrder = 0;
  private mapJson = '';
  private tickTimes: number[] = [];
  tickMsAvg = 0;
  tickMsMax = 0;
  private lastResult: ServerMsg | null = null;
  private readonly opts: Required<SessionOptions>;

  constructor(opts: SessionOptions = {}) {
    this.opts = {
      debug: opts.debug ?? false,
      now: opts.now ?? (() => performance.now() / 1000),
      log: opts.log ?? ((m) => console.log(m)),
      rand: opts.rand ?? Math.random,
    };
  }

  // ---- Connections -----------------------------------------------------

  onConnect(_conn: Conn): void {
    // Nothing until the client sends `join`.
  }

  onMessage(conn: Conn, raw: string): void {
    const msg = parseClientMsg(raw);
    if (!msg) return;
    const pid = this.connPlayer.get(conn);
    if (msg.t === 'join') {
      if (pid === undefined) this.join(conn, msg);
      return;
    }
    if (pid === undefined) return;
    const p = this.players.get(pid);
    if (!p) return;
    this.handle(p, msg);
  }

  onClose(conn: Conn): void {
    const pid = this.connPlayer.get(conn);
    this.connPlayer.delete(conn);
    if (pid === undefined) return;
    const p = this.players.get(pid);
    if (!p || p.conn !== conn) return;
    p.conn = null;
    p.disconnectedAt = this.opts.now();
    if (this.phase === 'lobby') this.removePlayer(p.id);
    else this.reassignAdmin();
    if (this.settings.autoNeutrals && this.phase === 'lobby') this.settings.neutrals = this.effectiveNeutrals();
    this.broadcastLobby();
  }

  private join(conn: Conn, msg: Extract<ClientMsg, { t: 'join' }>): void {
    if (msg.protocol !== PROTOCOL_VERSION) {
      this.sendTo(conn, { t: 'error', code: 'protocol', message: `Protocol mismatch: server ${PROTOCOL_VERSION}, client ${msg.protocol}` });
      conn.close();
      return;
    }
    let p = msg.token ? [...this.players.values()].find((q) => q.token === msg.token) : undefined;
    if (p) {
      // Reconnect (GAME.md 3.3): rebind the existing player and actor.
      if (p.conn && p.conn !== conn) {
        this.connPlayer.delete(p.conn);
        p.conn.close();
      }
      p.conn = conn;
      p.name = sanitizeName(msg.name, p.id);
    } else {
      const humans = [...this.players.values()].length;
      if (humans >= NET.MAX_HUMANS) {
        this.sendTo(conn, { t: 'error', code: 'full', message: 'Server is full' });
        conn.close();
        return;
      }
      const id = this.nextId++;
      p = {
        id,
        name: sanitizeName(msg.name, id),
        token: makeToken(),
        team: this.smallestTeam(),
        order: this.nextOrder++,
        conn,
        disconnectedAt: 0,
        ping: 0,
      };
      this.players.set(id, p);
    }
    this.connPlayer.set(conn, p.id);
    if (this.settings.autoNeutrals && this.phase === 'lobby') this.settings.neutrals = this.effectiveNeutrals();
    if (this.adminId < 0 || !this.players.get(this.adminId)?.conn) this.reassignAdmin();
    this.sendTo(conn, { t: 'welcome', id: p.id, token: p.token, protocol: PROTOCOL_VERSION, serverTime: this.opts.now() });
    if (this.match && (this.phase === 'countdown' || this.phase === 'live')) {
      // Late join or reconnect into a running match.
      if (!this.match.actors.has(p.id)) {
        p.team = this.smallestTeam(p.id);
        this.match.addActor(p.id, p.name, p.team, { spawnNow: false });
        this.broadcastRoster();
      }
      this.sendMatchStart(p);
    } else if (this.phase === 'ending' || this.phase === 'results') {
      if (this.match?.actors.has(p.id) && this.lastResult) this.sendTo(conn, this.lastResult);
    }
    this.broadcastLobby();
    this.opts.log(`[join] ${p.name} (#${p.id}) team ${p.team}`);
  }

  private handle(p: Player, msg: ClientMsg): void {
    const isAdmin = p.id === this.adminId;
    switch (msg.t) {
      case 'lobby/setTeam':
        if (this.phase === 'lobby' && Number.isInteger(msg.team) && msg.team >= -1 && msg.team < this.settings.teams) {
          p.team = msg.team === -1 ? this.smallestTeam(p.id) : msg.team;
          this.broadcastLobby();
        }
        break;
      case 'lobby/shuffle':
        if (isAdmin && this.phase === 'lobby') {
          this.shuffleTeams();
          this.broadcastLobby();
        }
        break;
      case 'lobby/settings':
        if (isAdmin && this.phase === 'lobby') {
          this.applySettings(msg.settings);
          this.broadcastLobby();
        }
        break;
      case 'lobby/start':
        if (isAdmin && this.phase === 'lobby') this.startMatch();
        break;
      case 'lobby/return':
        if (isAdmin && this.phase === 'results') this.toLobby();
        break;
      case 'lobby/kick':
        if (isAdmin && msg.id !== p.id) {
          const target = this.players.get(msg.id);
          if (target) {
            if (target.conn) {
              this.sendTo(target.conn, { t: 'error', code: 'kicked', message: 'Kicked by admin' });
              target.conn.close();
            }
            this.removePlayer(target.id);
            this.broadcastLobby();
          }
        }
        break;
      case 'input':
        if (this.match) this.match.queueInput(p.id, msg.seq, msg.steps);
        break;
      case 'spawn/request':
        if (this.match) this.match.setSpawn(p.id, msg.zone, msg.classId, msg.ready);
        break;
      case 'ping':
        p.ping = Math.max(0, Math.min(9999, Math.round(msg.rtt)));
        if (p.conn) this.sendTo(p.conn, { t: 'pong', t0: msg.t0, serverTime: this.opts.now() });
        break;
      case 'debug':
        if (!this.opts.debug || !this.match) break;
        if (msg.cmd === 'teleport') this.match.teleport(p.id, msg.x, msg.y, msg.z, msg.yaw, msg.pitch);
        else if (msg.cmd === 'damage') {
          const target = this.match.actors.get(msg.target);
          const src = this.match.actors.get(p.id) ?? null;
          if (target) this.match.applyDamage(target, src, msg.amount, false);
        }
        break;
      default:
        break;
    }
  }

  private applySettings(s: Partial<MatchSettings>): void {
    if (s.seed !== undefined) this.settings.seed = s.seed.trim().slice(0, 32);
    if (s.scoreLimit !== undefined && MATCH.scoreLimitOptions.includes(s.scoreLimit)) this.settings.scoreLimit = s.scoreLimit;
    if (s.timeLimitMin !== undefined && MATCH.timeLimitOptionsMin.includes(s.timeLimitMin)) this.settings.timeLimitMin = s.timeLimitMin;
    if (s.teams !== undefined && MATCH.teamOptions.includes(s.teams) && s.teams !== this.settings.teams) {
      this.settings.teams = s.teams;
      // Players on teams that no longer exist move to the smallest remaining team.
      for (const p of this.players.values()) if (p.team >= s.teams) p.team = this.smallestTeam(p.id);
      if (!isAllowedCombo(this.settings.teams, this.settings.neutrals)) {
        this.settings.neutrals = autoNeutrals(this.players.size, this.settings.teams);
        this.settings.autoNeutrals = true;
      }
    }
    if (s.autoNeutrals !== undefined) this.settings.autoNeutrals = s.autoNeutrals;
    if (s.vehicles !== undefined) this.settings.vehicles = s.vehicles;
    if (s.neutrals !== undefined && isAllowedCombo(this.settings.teams, s.neutrals)) {
      this.settings.neutrals = s.neutrals;
      if (s.autoNeutrals === undefined) this.settings.autoNeutrals = false;
    }
    if (this.settings.autoNeutrals) this.settings.neutrals = this.effectiveNeutrals();
  }

  /** Neutral zones for the match: Auto uses the participant count (GAME.md 4.1). */
  effectiveNeutrals(): number {
    if (!this.settings.autoNeutrals) return this.settings.neutrals;
    const participants = [...this.players.values()].filter((p) => p.conn).length;
    return autoNeutrals(participants, this.settings.teams);
  }

  /** Admin shuffle: random order, dealt round-robin so teams stay balanced. */
  private shuffleTeams(): void {
    const list = [...this.players.values()];
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(this.opts.rand() * (i + 1));
      [list[i], list[j]] = [list[j]!, list[i]!];
    }
    list.forEach((p, i) => (p.team = i % this.settings.teams));
  }

  /** Debug/E2E only: drop every player and return to a fresh lobby. */
  reset(): void {
    for (const p of [...this.players.values()]) p.conn?.close();
    this.players.clear();
    this.connPlayer.clear();
    this.match = null;
    this.lastResult = null;
    this.adminId = -1;
    this.settings = { teams: MATCH.defaultTeams, neutrals: 0, autoNeutrals: true, seed: '', scoreLimit: MATCH.defaultScoreLimit, timeLimitMin: MATCH.defaultTimeLimitMin, vehicles: true };
    this.setPhase('lobby');
  }

  // ---- Phases ----------------------------------------------------------

  startMatch(): void {
    const connected = [...this.players.values()].filter((p) => p.conn);
    if (connected.length < MATCH.minPlayersToStart) return;
    const seedText = this.settings.seed || String(Math.floor(this.opts.rand() * 1e9));
    const t0 = this.opts.now();
    for (const p of this.players.values()) if (p.team >= this.settings.teams) p.team = this.smallestTeam(p.id);
    const neutrals = this.effectiveNeutrals();
    this.settings.neutrals = neutrals;
    const generated = generateMap(seedFromString(seedText), this.settings.teams, neutrals);
    const blob = encodeMap(generated);
    this.mapJson = JSON.stringify(blob);
    // The server simulates on exactly the data clients receive.
    const map = decodeMap(JSON.parse(this.mapJson));
    this.match = new Match(map, { ...this.settings, seed: seedText }, this.opts.rand);
    for (const p of this.players.values()) {
      if (!p.conn) continue;
      // Actors deploy when LIVE starts; during the countdown everyone picks class and zone.
      const a = this.match.addActor(p.id, p.name, p.team, { spawnNow: false });
      a.respawnT = 0;
    }
    this.setPhase('countdown');
    for (const p of this.players.values()) if (p.conn) this.sendMatchStart(p);
    this.broadcastLobby();
    this.opts.log(`[match] start seed=${seedText} (map seed ${map.seed}, ${map.props.length} props, ${((this.opts.now() - t0) * 1000).toFixed(0)} ms)`);
  }

  private setPhase(ph: Phase): void {
    this.phase = ph;
    this.phaseT = 0;
  }

  private toLobby(): void {
    this.match = null;
    this.lastResult = null;
    this.setPhase('lobby');
    for (const p of [...this.players.values()]) if (!p.conn) this.removePlayer(p.id);
    this.broadcastLobby();
  }

  private sendMatchStart(p: Player): void {
    if (!this.match || !p.conn) return;
    this.match.resetInputSeq(p.id);
    const head = JSON.stringify({ t: 'match/start', settings: this.match.settings, you: p.id, roster: this.roster(), tick: this.match.tick });
    p.conn.send(`${head.slice(0, -1)},"map":${this.mapJson}}`);
  }

  // ---- Tick ------------------------------------------------------------

  tick(): void {
    const t0 = performance.now();
    this.phaseT += DT;
    this.expireDisconnected();
    const m = this.match;
    if (m) {
      const live = this.phase === 'live';
      m.step(DT, live);
      if (this.phase === 'countdown' && this.phaseT >= MATCH.countdownS) {
        this.setPhase('live');
        m.readyAll();
      }
      if (live && m.result) {
        this.setPhase('ending');
        const rows = m.boardRows((id) => this.players.get(id)?.ping ?? 0);
        this.lastResult = { t: 'match/end', winner: m.result.winner, reason: m.result.reason, scores: m.scores.map((s) => Math.floor(s)), rows };
        this.broadcast(this.lastResult);
        this.opts.log(`[match] end winner=${m.result.winner} reason=${m.result.reason}`);
      }
      if (this.phase === 'ending' && this.phaseT >= MATCH.endingS) {
        this.setPhase('results');
        this.broadcastLobby();
      }
      if (this.phase === 'results' && this.phaseT >= MATCH.resultsS) this.toLobby();
      if (this.match) {
        this.sendSnapshots(m);
        this.sendEvents(m);
        m.clearTickOutputs();
        if (m.tick % NET.BOARD_INTERVAL_TICKS === 0) this.broadcast({ t: 'board', rows: m.boardRows((id) => this.players.get(id)?.ping ?? 0), tickMs: Math.round(this.tickMsAvg * 100) / 100 });
      }
    }
    const ms = performance.now() - t0;
    this.tickTimes.push(ms);
    if (this.tickTimes.length > 30) this.tickTimes.shift();
    this.tickMsAvg = this.tickTimes.reduce((a, b) => a + b, 0) / this.tickTimes.length;
    this.tickMsMax = Math.max(...this.tickTimes);
  }

  private timeLeft(m: Match): number {
    switch (this.phase) {
      case 'countdown':
        return Math.max(0, MATCH.countdownS - this.phaseT);
      case 'ending':
        return Math.max(0, MATCH.endingS - this.phaseT);
      case 'results':
        return Math.max(0, MATCH.resultsS - this.phaseT);
      default:
        return m.settings.timeLimitMin > 0 ? Math.max(0, m.settings.timeLimitMin * 60 - m.elapsedS) : -1;
    }
  }

  private sendSnapshots(m: Match): void {
    const shared = JSON.stringify({
      phase: this.phase,
      timeLeft: Math.round(this.timeLeft(m) * 10) / 10,
      a: m.actorArray(),
      z: m.zoneArray(),
      s: m.scores.map((x) => Math.floor(x * 10) / 10),
      shots: m.shots,
      p: m.projectileArray(),
      d: m.deployableArray(),
      tc: m.totalControl(),
      v: m.vehicleArray(),
    });
    const body = shared.slice(1);
    for (const p of this.players.values()) {
      if (!p.conn) continue;
      const a = m.actors.get(p.id);
      const me = m.me(p.id);
      p.conn.send(`{"t":"snapshot","tick":${m.tick},"ack":${a ? a.ackSeq : -1},"me":${JSON.stringify(me)},${body}`);
    }
  }

  private sendEvents(m: Match): void {
    if (m.broadcastEvents.length === 0 && m.privateEvents.size === 0) return;
    for (const p of this.players.values()) {
      if (!p.conn) continue;
      const priv = m.privateEvents.get(p.id);
      const e = priv ? [...m.broadcastEvents, ...priv] : m.broadcastEvents;
      if (e.length > 0) this.sendTo(p.conn, { t: 'event', tick: m.tick, e });
    }
  }

  // ---- Players ---------------------------------------------------------

  private expireDisconnected(): void {
    const now = this.opts.now();
    for (const p of [...this.players.values()]) {
      if (!p.conn && now - p.disconnectedAt > NET.RECONNECT_GRACE_S) {
        this.removePlayer(p.id);
        this.broadcastLobby();
      }
    }
  }

  private removePlayer(id: number): void {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    if (p.conn) this.connPlayer.delete(p.conn);
    if (this.match?.actors.has(id)) {
      this.match.removeActor(id);
      this.broadcastRoster();
    }
    if (this.adminId === id) this.reassignAdmin();
    this.opts.log(`[leave] ${p.name} (#${id})`);
  }

  private reassignAdmin(): void {
    let best: Player | null = null;
    for (const p of this.players.values()) if (p.conn && (!best || p.order < best.order)) best = p;
    this.adminId = best ? best.id : -1;
  }

  /** Team with the fewest humans (lowest index on ties). */
  private smallestTeam(exclude = -1): number {
    const counts = new Array<number>(this.settings.teams).fill(0);
    for (const p of this.players.values()) if (p.id !== exclude && p.team >= 0 && p.team < counts.length) counts[p.team]!++;
    let best = 0;
    for (let t = 1; t < counts.length; t++) if (counts[t]! < counts[best]!) best = t;
    return best;
  }

  private roster(): ActorInfo[] {
    if (!this.match) return [];
    return [...this.match.actors.values()].map((a) => ({ id: a.id, name: a.name, team: a.team, bot: a.bot }));
  }

  lobbyPlayers(): LobbyPlayer[] {
    return [...this.players.values()]
      .sort((a, b) => a.order - b.order)
      .map((p) => ({ id: p.id, name: p.name, team: p.team, admin: p.id === this.adminId, connected: !!p.conn, ping: p.ping }));
  }

  // ---- Sending ---------------------------------------------------------

  private sendTo(conn: Conn, m: ServerMsg): void {
    conn.send(encodeMsg(m));
  }

  private broadcast(m: ServerMsg): void {
    const s = encodeMsg(m);
    for (const p of this.players.values()) p.conn?.send(s);
  }

  private broadcastLobby(): void {
    this.broadcast({ t: 'lobby/state', phase: this.phase, players: this.lobbyPlayers(), adminId: this.adminId, settings: this.settings });
  }

  private broadcastRoster(): void {
    this.broadcast({ t: 'roster', roster: this.roster() });
  }
}

export function sanitizeName(raw: string, id: number): string {
  // eslint-disable-next-line no-control-regex
  const s = raw.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, NET.MAX_NAME_LENGTH);
  return s.length > 0 ? s : `Player ${id}`;
}

function makeToken(): string {
  return randomUUID();
}
