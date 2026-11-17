import './ui/style.css';
import { BTN, NET } from '@zona/shared';
import { Audio } from './audio';
import { GameClient } from './game';
import { setLang, t } from './i18n';
import { ACTIONS, Input, keyLabel } from './input';
import { Net } from './net';
import { View } from './render/view';
import { loadSettings, saveSettings, sessionDel, sessionGet } from './settings';
import { h } from './ui/dom';
import { assets } from './render/assets';
import { Hud } from './ui/hud';
import { Menus } from './ui/menus';

function hasWebGL2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

function boot(): void {
  const settings = loadSettings();
  setLang(settings.lang);
  const uiRoot = document.getElementById('ui')!;
  if (!hasWebGL2()) {
    uiRoot.append(h('div', { class: 'screen' }, h('div', { class: 'card interactive' }, h('h1', { class: 'logo' }, 'ZONA'), h('p', {}, t('error.webgl2')))));
    return;
  }
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const view = new View(canvas, settings);
  const input = new Input(canvas);
  const audio = new Audio();
  const net = new Net();
  const hud = new Hud(uiRoot);
  let game: GameClient | null = null;
  let lastName = settings.name;
  let userLeft = false;
  const join = (name: string): void => {
    lastName = name;
    userLeft = false;
    net.connect(name, sessionGet('zona.token')).catch(() => menus.showMenu(t('menu.disconnected')));
  };
  const menus = new Menus(uiRoot, settings, {
    join: (name) => {
      audio.unlock();
      join(name);
    },
    setTeam: (team) => net.send({ t: 'lobby/setTeam', team }),
    shuffle: () => net.send({ t: 'lobby/shuffle' }),
    lobbySettings: (s) => net.send({ t: 'lobby/settings', settings: s }),
    start: () => {
      audio.unlock();
      net.send({ t: 'lobby/start' });
      input.requestLock();
    },
    returnToLobby: () => net.send({ t: 'lobby/return' }),
    settingsChanged: (s) => {
      saveSettings(s);
      input.setBindings(s.keys);
      game?.setSettings(s);
    },
    leave: () => {
      userLeft = true;
      sessionDel('zona.token');
      net.close();
      if (game?.match && game.lobby) game.onMessage({ t: 'lobby/state', phase: 'lobby', players: [], adminId: -1, settings: game.lobby.settings });
      menus.showMenu();
    },
    resume: () => game?.resume(),
  }, ACTIONS, keyLabel);
  input.setBindings(settings.keys);
  game = new GameClient(view, hud, menus, input, audio, net, settings, uiRoot);
  game.setSettings(settings);
  net.onMessage = (m) => {
    // Server errors (kicked, full, protocol) are followed by a close: do not reconnect.
    if (m.t === 'error') {
      userLeft = true;
      sessionDel('zona.token');
    }
    game!.onMessage(m);
  };
  // Reconnect flow (GAME.md 3.3): keep the match on screen and retry with the stored
  // token for as long as the server keeps our actor (RECONNECT_GRACE_S).
  const overlay = h('div', { class: 'reconnect hidden' });
  uiRoot.append(overlay);
  const giveUp = (): void => {
    overlay.classList.add('hidden');
    const lobby = game!.lobby;
    if (game!.match && lobby) game!.onMessage({ t: 'lobby/state', phase: 'lobby', players: [], adminId: -1, settings: lobby.settings });
    menus.showMenu(t('menu.disconnected'));
  };
  net.onClose = () => {
    const token = sessionGet('zona.token');
    if (userLeft || !token) {
      giveUp();
      return;
    }
    const t0 = performance.now();
    overlay.classList.remove('hidden');
    const attempt = (): void => {
      const left = NET.RECONNECT_GRACE_S - (performance.now() - t0) / 1000;
      if (left <= 0) {
        giveUp();
        return;
      }
      overlay.textContent = t('net.reconnecting', { s: Math.ceil(left) });
      net
        .connect(lastName, token)
        .then(() => overlay.classList.add('hidden'))
        .catch(() => setTimeout(attempt, 2000));
    };
    attempt();
  };
  window.addEventListener('resize', () => view.resize());
  // Soft click for UI buttons.
  uiRoot.addEventListener('click', (e) => {
    if (e.target instanceof HTMLButtonElement) audio.uiClick();
  });
  // Ctrl is a crouch key and Ctrl+W closes the tab in most browsers; ask before leaving a running match.
  window.addEventListener('beforeunload', (e) => {
    if (game?.match && !input.testMode) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  let last = performance.now();
  const loop = (): void => {
    const now = performance.now();
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    game!.frame(dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  // A reload of a tab that was in a game rejoins automatically with its token.
  if (sessionGet('zona.token')) join(settings.name);

  // Testing hooks (read-only state + helpers; debug commands only work when the server allows them).
  const g = game;
  (window as unknown as { __zona: unknown }).__zona = {
    state: () => g.testState(),
    setLook: (yaw: number, pitch: number) => g.setLook(yaw, pitch),
    press: (names: string[]) => input.setButtons(names.reduce((b, n) => b | (BTN as Record<string, number>)[n]!, 0)),
    teleport: (x: number, y: number, z: number, yaw: number, pitch: number) => net.send({ t: 'debug', cmd: 'teleport', x, y, z, yaw, pitch }),
    damage: (target: number, amount: number) => net.send({ t: 'debug', cmd: 'damage', target, amount }),
    spawn: (cls: string, zone: number) => g.testSpawn(cls as never, zone),
    slot: (n: number) => g.testSlot(n),
    send: (m: Parameters<Net['send']>[0]) => net.send(m),
    dropConnection: () => net.close(),
    camera: (mode: 'first' | 'third' | 'top') => g.setCameraMode(mode),
    assetsFailed: () => assets.failed,
  };
}

boot();
