/** Tiny DOM helpers. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else el.setAttribute(k, v);
  }
  for (const c of children) el.append(c);
  return el;
}

/** Set text only when it changed (avoids layout work in the frame loop). */
export function setText(el: HTMLElement, s: string): void {
  if (el.textContent !== s) el.textContent = s;
}

export function show(el: HTMLElement, on: boolean): void {
  const hidden = el.classList.contains('hidden');
  if (on && hidden) el.classList.remove('hidden');
  else if (!on && !hidden) el.classList.add('hidden');
}

export function setStyle(el: HTMLElement, prop: string, value: string): void {
  const s = el.style as unknown as Record<string, string>;
  if (s[prop] !== value) s[prop] = value;
}

export function fmtTime(s: number): string {
  if (s < 0) return '∞';
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${ss.toString().padStart(2, '0')}`;
}
