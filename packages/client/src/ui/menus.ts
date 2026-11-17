import {
  ALLOWED_NEUTRALS,
  GRAPHICS,
  MATCH,
  TEAM_COLORS,
  TEAM_NAME_KEYS,
  layoutZones,
  playableRadius,
  type ActorInfo,
  type BoardRow,
  type LobbyPlayer,
  type MatchSettings,
  type Phase,
  type WinReason,
} from '@zona/shared';
import { getLang, onLangChange, setLang, t, type Lang } from '../i18n';
import type { Settings } from '../settings';
import { h, show } from './dom';

export interface MenuCallbacks {
  join(name: string): void;
  setTeam(team: number): void;
  shuffle(): void;
  lobbySettings(s: Partial<MatchSettings>): void;
  start(): void;
  returnToLobby(): void;
  settingsChanged(s: Settings): void;
  leave(): void;
  resume(): void;
}

export interface ResultsData {
  winner: number;
  reason: WinReason;
  scores: number[];
  rows: BoardRow[];
  roster: Map<number, ActorInfo>;
  myId: number;
}

const teamName = (team: number): string => t(TEAM_NAME_KEYS[team] ?? 'team.blue');

/** Main menu, lobby, results, settings and pause screens (GAME.md 10). */
export class Menus {
  private readonly root: HTMLElement;
  private readonly menu: HTMLElement;
  private readonly lobby: HTMLElement;
  private readonly results: HTMLElement;
  private readonly settingsModal: HTMLElement;
  private readonly pause: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly joinBtn: HTMLButtonElement;
  private readonly menuError: HTMLElement;
  private lobbyState: { phase: Phase; players: LobbyPlayer[]; adminId: number; settings: MatchSettings } | null = null;
  private myId = -1;
  private resultsData: ResultsData | null = null;
  private resultsLeft = 0;

  constructor(
    root: HTMLElement,
    private settings: Settings,
    private readonly cb: MenuCallbacks,
  ) {
    this.root = root;
    this.nameInput = h('input', { maxlength: '16', autocomplete: 'off', spellcheck: 'false' });
    this.nameInput.value = settings.name;
    this.joinBtn = h('button', { class: 'primary' });
    this.menuError = h('div', { class: 'error-text' });
    this.menu = h('div', { class: 'screen' });
    this.lobby = h('div', { class: 'screen hidden' });
    this.results = h('div', { class: 'screen hidden' });
    this.settingsModal = h('div', { class: 'modal hidden' });
    this.pause = h('div', { class: 'pause hidden' });
    root.append(this.menu, this.lobby, this.results, this.pause, this.settingsModal);
    this.joinBtn.addEventListener('click', () => this.doJoin());
    this.nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.doJoin();
    });
    this.pause.addEventListener('click', (e) => {
      if (e.target === this.pause) this.cb.resume();
    });
    this.renderMenu();
    onLangChange(() => this.rerender());
  }

  private rerender(): void {
    this.renderMenu();
    if (this.lobbyState) this.renderLobby();
    if (this.resultsData) this.renderResults();
    this.renderPause();
    if (!this.settingsModal.classList.contains('hidden')) this.openSettings();
  }

  private doJoin(): void {
    const name = this.nameInput.value.trim();
    this.settings.name = name;
    this.cb.settingsChanged(this.settings);
    this.joinBtn.disabled = true;
    this.joinBtn.textContent = t('menu.connecting');
    this.cb.join(name);
  }

  private renderMenu(): void {
    const langBtn = h('button', {}, getLang() === 'uz' ? 'English' : "O'zbekcha");
    langBtn.addEventListener('click', () => this.setLanguage(getLang() === 'uz' ? 'en' : 'uz'));
    const settingsBtn = h('button', {}, t('menu.settings'));
    settingsBtn.addEventListener('click', () => this.openSettings());
    this.joinBtn.textContent = t('menu.join');
    this.nameInput.placeholder = t('menu.name');
    const card = h(
      'div',
      { class: 'card interactive' },
      h('h1', { class: 'logo' }, h('span', {}, 'ZO'), h('span', {}, 'NA')),
      h('p', { class: 'subtitle' }, t('menu.subtitle')),
      h('label', { class: 'field' }, t('menu.name'), this.nameInput),
      h('div', { class: 'row' }, this.joinBtn, settingsBtn, langBtn),
      this.menuError,
      h('p', { class: 'small' }, t('menu.hostInfo'), ' ', h('span', { class: 'host-url' }, location.host)),
      h('p', { class: 'small' }, t('menu.controls')),
    );
    this.menu.replaceChildren(card);
  }

  private setLanguage(l: Lang): void {
    this.settings.lang = l;
    this.cb.settingsChanged(this.settings);
    setLang(l);
  }

  showMenu(error?: string): void {
    this.hideAll();
    show(this.menu, true);
    this.joinBtn.disabled = false;
    this.joinBtn.textContent = t('menu.join');
    this.menuError.textContent = error ?? '';
    this.lobbyState = null;
    this.resultsData = null;
    setTimeout(() => this.nameInput.focus(), 0);
  }

  private hideAll(): void {
    for (const el of [this.menu, this.lobby, this.results, this.pause]) show(el, false);
  }

  hideScreens(): void {
    this.hideAll();
  }

  // ---- Lobby -------------------------------------------------------------

  showLobby(state: { phase: Phase; players: LobbyPlayer[]; adminId: number; settings: MatchSettings }, myId: number): void {
    this.lobbyState = state;
    this.myId = myId;
    this.resultsData = null;
    this.hideAll();
    show(this.lobby, true);
    this.renderLobby();
  }

  updateLobby(state: { phase: Phase; players: LobbyPlayer[]; adminId: number; settings: MatchSettings }, myId: number): void {
    this.lobbyState = state;
    this.myId = myId;
    if (!this.lobby.classList.contains('hidden')) this.renderLobby();
  }

  private renderLobby(): void {
    const st = this.lobbyState!;
    const isAdmin = st.adminId === this.myId;
    const teams = h('div', { class: 'teams' });
    for (let team = 0; team < st.settings.teams; team++) {
      const list = h('ul');
      for (const p of st.players.filter((q) => q.team === team)) {
        const li = h('li', {}, h('span', { class: 'swatch', style: `background:${TEAM_COLORS[team]}` }), p.name);
        if (p.admin) li.append(h('span', { class: 'badge admin' }, t('lobby.admin')));
        if (p.id === this.myId) li.append(h('span', { class: 'badge you' }, t('lobby.you')));
        if (!p.connected) li.append(h('span', { class: 'badge' }, t('lobby.disconnected')));
        list.append(li);
      }
      const me = st.players.find((p) => p.id === this.myId);
      const joinBtn = h('button', {}, t('lobby.joinTeam'));
      joinBtn.disabled = me?.team === team || st.phase !== 'lobby';
      joinBtn.addEventListener('click', () => this.cb.setTeam(team));
      teams.append(h('div', { class: 'team-col' }, h('h3', { style: `color:${TEAM_COLORS[team]}` }, teamName(team)), list, joinBtn));
    }

    const s = st.settings;
    const seed = h('input', { placeholder: t('lobby.seedRandom'), maxlength: '32' });
    seed.value = s.seed;
    seed.disabled = !isAdmin;
    seed.addEventListener('change', () => this.cb.lobbySettings({ seed: seed.value }));
    const rnd = h('button', {}, t('lobby.random'));
    rnd.disabled = !isAdmin;
    rnd.addEventListener('click', () => this.cb.lobbySettings({ seed: String(Math.floor(Math.random() * 1e6)) }));
    const scoreSel = h('select');
    for (const v of MATCH.scoreLimitOptions) scoreSel.append(h('option', { value: String(v) }, v === 0 ? t('lobby.off') : String(v)));
    scoreSel.value = String(s.scoreLimit);
    scoreSel.disabled = !isAdmin;
    scoreSel.addEventListener('change', () => this.cb.lobbySettings({ scoreLimit: Number(scoreSel.value) }));
    const timeSel = h('select');
    for (const v of MATCH.timeLimitOptionsMin) timeSel.append(h('option', { value: String(v) }, v === 0 ? t('lobby.off') : t('lobby.min', { n: v })));
    timeSel.value = String(s.timeLimitMin);
    timeSel.disabled = !isAdmin;
    timeSel.addEventListener('change', () => this.cb.lobbySettings({ timeLimitMin: Number(timeSel.value) }));

    const teamSel = h('select', { 'data-testid': 'teams' });
    for (const v of MATCH.teamOptions) teamSel.append(h('option', { value: String(v) }, String(v)));
    teamSel.value = String(s.teams);
    teamSel.disabled = !isAdmin;
    teamSel.addEventListener('change', () => this.cb.lobbySettings({ teams: Number(teamSel.value) }));
    const nSel = h('select', { 'data-testid': 'neutrals' });
    nSel.append(h('option', { value: 'auto' }, t('lobby.auto', { n: s.autoNeutrals ? s.neutrals : '…' })));
    for (const v of ALLOWED_NEUTRALS[s.teams] ?? []) nSel.append(h('option', { value: String(v) }, String(v)));
    nSel.value = s.autoNeutrals ? 'auto' : String(s.neutrals);
    nSel.disabled = !isAdmin;
    nSel.addEventListener('change', () => this.cb.lobbySettings(nSel.value === 'auto' ? { autoNeutrals: true } : { autoNeutrals: false, neutrals: Number(nSel.value) }));
    const autoTeam = h('button', {}, t('lobby.autoTeam'));
    autoTeam.disabled = st.phase !== 'lobby';
    autoTeam.addEventListener('click', () => this.cb.setTeam(-1));
    const shuffle = h('button', {}, t('lobby.shuffle'));
    shuffle.addEventListener('click', () => this.cb.shuffle());
    const teamTools = h('div', { class: 'row', style: 'margin-bottom:14px' }, autoTeam);
    if (isAdmin && st.phase === 'lobby') teamTools.append(shuffle);
    const startBtn = h('button', { class: 'primary', 'data-testid': 'start' }, t('lobby.start'));
    startBtn.addEventListener('click', () => this.cb.start());
    const footer =
      st.phase !== 'lobby'
        ? h('p', { class: 'small' }, st.phase === 'ending' || st.phase === 'results' ? t('lobby.matchEnding') : t('lobby.inMatch'))
        : isAdmin
          ? startBtn
          : h('p', { class: 'small' }, t('lobby.waitAdmin'));

    const settingsBox = h(
      'div',
      { class: 'settings-grid lobby-grid' },
      h('label', { class: 'field' }, t('lobby.teams'), teamSel),
      h('label', { class: 'field' }, t('lobby.neutrals'), nSel),
      h('label', { class: 'field' }, t('lobby.seed'), h('div', { class: 'row' }, seed, rnd)),
      h('label', { class: 'field' }, t('lobby.scoreLimit'), scoreSel),
      h('label', { class: 'field' }, t('lobby.timeLimit'), timeSel),
      h('div', { class: 'field' }, `${t('lobby.layout')} · ${t('lobby.zonesTotal', { n: s.teams + s.neutrals })}`, this.layoutPreview(s.teams, s.neutrals)),
    );
    const card = h('div', { class: 'card wide interactive' }, h('h2', {}, t('lobby.title')), teams, teamTools, settingsBox, footer);
    this.lobby.replaceChildren(card);
  }

  private layoutPreview(teams: number, neutrals: number): SVGSVGElement {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '-110 -110 220 220');
    svg.setAttribute('class', 'layout-preview');
    const R = playableRadius(teams + neutrals);
    const ring = document.createElementNS(ns, 'circle');
    ring.setAttribute('r', '100');
    ring.setAttribute('fill', '#1f2937');
    ring.setAttribute('stroke', '#4b5563');
    svg.append(ring);
    layoutZones(teams, neutrals).forEach((z, i) => {
      const c = document.createElementNS(ns, 'circle');
      c.setAttribute('cx', String((z.x / R) * 100));
      c.setAttribute('cy', String((z.z / R) * 100));
      c.setAttribute('r', '16');
      c.setAttribute('fill', z.homeTeam >= 0 ? TEAM_COLORS[z.homeTeam]! : '#e5e7eb');
      const tx = document.createElementNS(ns, 'text');
      tx.setAttribute('x', String((z.x / R) * 100));
      tx.setAttribute('y', String((z.z / R) * 100 + 6));
      tx.setAttribute('text-anchor', 'middle');
      tx.setAttribute('font-size', '18');
      tx.setAttribute('font-weight', '900');
      tx.setAttribute('fill', '#111');
      tx.textContent = 'ABCDEFGH'[i]!;
      svg.append(c, tx);
    });
    return svg;
  }

  // ---- Results -----------------------------------------------------------

  showResults(d: ResultsData, secondsLeft: number, isAdmin: boolean): void {
    this.resultsData = d;
    this.resultsLeft = secondsLeft;
    this.hideAll();
    show(this.results, true);
    this.renderResults(isAdmin);
  }

  private renderResults(isAdmin = this.lobbyState?.adminId === this.myId): void {
    const d = this.resultsData!;
    const title = d.winner >= 0 ? t('end.wins', { team: teamName(d.winner) }) : t('end.draw');
    const tables = h('div', { class: 'teams' });
    d.scores.forEach((score, team) => {
      const tbl = h(
        'table',
        {},
        h('tr', {}, h('th', {}, t('board.player')), h('th', {}, t('board.kills')), h('th', {}, t('board.deaths')), h('th', {}, t('board.caps'))),
      );
      for (const r of d.rows.filter((x) => d.roster.get(x.id)?.team === team).sort((a, b) => b.kills - a.kills)) {
        tbl.append(h('tr', {}, h('td', {}, d.roster.get(r.id)?.name ?? '?'), h('td', { class: 'num' }, String(r.kills)), h('td', { class: 'num' }, String(r.deaths)), h('td', { class: 'num' }, String(r.caps))));
      }
      tables.append(h('div', { class: 'team-col' }, h('h3', { style: `color:${TEAM_COLORS[team]}` }, teamName(team), h('span', { class: 'num' }, String(score))), tbl));
    });
    const back = h('button', { class: 'primary' }, t('results.back'));
    back.addEventListener('click', () => this.cb.returnToLobby());
    const card = h(
      'div',
      { class: 'card wide interactive results' },
      h('h2', { style: `color:${d.winner >= 0 ? TEAM_COLORS[d.winner] : '#fff'}` }, title),
      h('p', { class: 'small' }, t(`end.reason.${d.reason}`)),
      tables,
      h('div', { class: 'row' }, isAdmin ? back : h('span', { class: 'small' }, t('results.waitAdmin')), h('span', { class: 'small', id: 'results-auto' }, t('results.auto', { s: Math.ceil(this.resultsLeft) }))),
    );
    this.results.replaceChildren(card);
  }

  updateResultsTimer(secondsLeft: number): void {
    this.resultsLeft = secondsLeft;
    const el = this.results.querySelector('#results-auto');
    if (el) el.textContent = t('results.auto', { s: Math.ceil(secondsLeft) });
  }

  // ---- Pause / settings --------------------------------------------------

  showPause(on: boolean): void {
    if (on) this.renderPause();
    show(this.pause, on);
  }

  private renderPause(): void {
    const settingsBtn = h('button', {}, t('menu.settings'));
    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openSettings();
    });
    const leaveBtn = h('button', {}, t('pause.leave'));
    leaveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.cb.leave();
    });
    const resume = h('button', { class: 'primary' }, t('pause.resume'));
    resume.addEventListener('click', (e) => {
      e.stopPropagation();
      this.cb.resume();
    });
    this.pause.replaceChildren(h('div', { class: 'card interactive' }, h('h2', {}, 'ZONA'), h('div', { class: 'row', style: 'justify-content:center' }, resume, settingsBtn, leaveBtn), h('p', { class: 'small' }, t('menu.controls'))));
  }

  openSettings(): void {
    const s = this.settings;
    const apply = (): void => this.cb.settingsChanged(s);
    const range = (key: keyof Settings, min: number, max: number, step: number, fmt: (v: number) => string): HTMLElement => {
      const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step) });
      input.value = String(s[key]);
      const val = h('span', { class: 'num' }, fmt(Number(input.value)));
      input.addEventListener('input', () => {
        (s as unknown as Record<string, number>)[key] = Number(input.value);
        val.textContent = fmt(Number(input.value));
        apply();
      });
      return h('div', { class: 'row' }, input, val);
    };
    const preset = h('select');
    for (const p of ['low', 'medium', 'high'] as const) preset.append(h('option', { value: p }, t(`settings.${p}`)));
    preset.value = s.preset;
    preset.addEventListener('change', () => {
      s.preset = preset.value as Settings['preset'];
      apply();
    });
    const invert = h('input', { type: 'checkbox' });
    invert.checked = s.invertY;
    invert.addEventListener('change', () => {
      s.invertY = invert.checked;
      apply();
    });
    const lang = h('select');
    lang.append(h('option', { value: 'uz' }, "O'zbekcha"), h('option', { value: 'en' }, 'English'));
    lang.value = s.lang;
    lang.addEventListener('change', () => this.setLanguage(lang.value as Lang));
    const close = h('button', { class: 'primary' }, t('settings.close'));
    close.addEventListener('click', () => show(this.settingsModal, false));
    const pct = (v: number): string => `${Math.round(v * 100)}%`;
    const card = h(
      'div',
      { class: 'card interactive' },
      h('h2', {}, t('settings.title')),
      h(
        'div',
        { class: 'settings-grid' },
        h('label', { class: 'field' }, t('settings.sensitivity'), range('sensitivity', 0.2, 3, 0.05, (v) => v.toFixed(2))),
        h('label', { class: 'field' }, t('settings.adsSens'), range('adsSensMult', 0.3, 1.5, 0.05, (v) => v.toFixed(2))),
        h('label', { class: 'field' }, t('settings.fov'), range('fov', GRAPHICS.fovMin, GRAPHICS.fovMax, 1, (v) => `${v}°`)),
        h('label', { class: 'field' }, t('settings.invertY'), invert),
        h('label', { class: 'field' }, t('settings.volume'), range('volume', 0, 1, 0.05, pct)),
        h('label', { class: 'field' }, t('settings.sfx'), range('sfxVolume', 0, 1, 0.05, pct)),
        h('label', { class: 'field' }, t('settings.preset'), preset),
        h('label', { class: 'field' }, t('settings.renderScale'), range('renderScale', GRAPHICS.renderScaleMin, GRAPHICS.renderScaleMax, 0.05, pct)),
        h('label', { class: 'field' }, t('settings.language'), lang),
      ),
      h('p', { class: 'small' }, t('settings.aaNote')),
      close,
    );
    this.settingsModal.replaceChildren(card);
    show(this.settingsModal, true);
  }

  settingsOpen(): boolean {
    return !this.settingsModal.classList.contains('hidden');
  }

  get rootEl(): HTMLElement {
    return this.root;
  }
}
