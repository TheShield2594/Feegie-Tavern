/** Tiny DOM helpers. Keeps the UI code declarative without a framework. */

type Attrs = Record<string, string | number | boolean | undefined | null | EventListener>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string | null | undefined)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'class') {
      node.className = String(value);
    } else if (key === 'html') {
      node.innerHTML = String(value);
    } else if (key === 'text') {
      node.textContent = String(value);
    } else if (key === 'style' && typeof value === 'string') {
      node.setAttribute('style', value);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Removes a node after an exit animation class has played. */
export function removeAfter(node: Element, className: string, ms: number): void {
  node.classList.add(className);
  window.setTimeout(() => node.remove(), ms);
}

/** Animates a number, for currency counters and friendship totals. */
export function countUp(node: HTMLElement, from: number, to: number, ms = 520, format = (n: number) => String(n)): void {
  if (from === to) {
    node.textContent = format(to);
    return;
  }
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / ms);
    // Ease out so the last digits settle rather than snapping.
    const eased = 1 - Math.pow(1 - t, 3);
    node.textContent = format(Math.round(from + (to - from) * eased));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function formatCoins(n: number): string {
  return n.toLocaleString('en-US');
}
