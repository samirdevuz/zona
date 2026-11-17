import './ui/style.css';
import { BTN } from '@zona/shared';
import { Audio } from './audio';
import { GameClient } from './game';
import { setLang, t } from './i18n';
import { Input } from './input';
import { Net } from './net';
import { View } from './render/view';
import { loadSettings, saveSettings, sessionGet } from './settings';
import { h } from './ui/dom';
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
  const menus = new Menus(uiRoot, settings, {
    join: (name) => {
      audio.unlock();
      net
        .connect(name, sessionGet('zona.token'))
        .catch(() => menus.showMenu(t('menu.disconnected')));
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
      game?.setSettings(s);
    },
    leave: () => {
      net.close();
      menus.showMenu();
    },
    resume: () => game?.resume(),
  });
  game = new GameClient(view, hud, menus, input, audio, net, settings, uiRoot);
  game.setSettings(settings);
  net.onMessage = (m) => game!.onMessage(m);
  net.onClose = () => {
    const lobby = game!.lobby;
    if (game!.match && lobby) game!.onMessage({ t: 'lobby/state', phase: 'lobby', players: [], adminId: -1, settings: lobby.settings });
    menus.showMenu(t('menu.disconnected'));
  };
  window.addEventListener('resize', () => view.resize());
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
  };
}

boot();
