/**
 * Inline SVG icons.
 *
 * Drawn rather than borrowed, and used everywhere the UI would otherwise be
 * tempted to reach for an emoji.
 */

const wrap = (body: string, size = 20, viewBox = '0 0 24 24'): string =>
  `<svg class="cc-icon" width="${size}" height="${size}" viewBox="${viewBox}" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;

export const Icons = {
  shell: (size = 20, color = '#e0b45f') =>
    wrap(
      `<path d="M12 3c4.9 0 8.6 4.1 8.6 9 0 3.4-2 6.6-5 7.7-.6.2-1.2-.3-1-.9.7-2.1 1-4.3 1-6.4C15.6 8 14 4.6 12 3Z" fill="${color}"/>
       <path d="M12 3c-4.9 0-8.6 4.1-8.6 9 0 3.4 2 6.6 5 7.7.6.2 1.2-.3 1-.9-.7-2.1-1-4.3-1-6.4C8.4 8 10 4.6 12 3Z" fill="${color}" opacity=".72"/>
       <path d="M12 3c1.4 2.2 2.2 5.6 2.2 9.4 0 2.3-.3 4.6-1 6.7-.3.9-1.1.9-1.4 0-.7-2.1-1-4.4-1-6.7C10.8 8.6 11.6 5.2 12 3Z" fill="#fff" opacity=".35"/>`,
      size,
    ),

  sun: (size = 20) =>
    wrap(
      `<circle cx="12" cy="12" r="4.6" fill="#f0b93f"/>
       <g stroke="#f0b93f" stroke-width="1.9" stroke-linecap="round">
         <path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4 17 7M7 17l-1.6 1.6"/>
       </g>`,
      size,
    ),

  cloud: (size = 20) =>
    wrap(
      `<path d="M7.4 18h9.3a3.9 3.9 0 0 0 .5-7.8 5.4 5.4 0 0 0-10.3-1A3.9 3.9 0 0 0 7.4 18Z" fill="#c3cdd6"/>
       <path d="M7.4 18h4.2a3.9 3.9 0 0 1-.7-7.7 5.4 5.4 0 0 1 2.6-3.9 5.4 5.4 0 0 0-6.6 4A3.9 3.9 0 0 0 7.4 18Z" fill="#dfe6ec"/>`,
      size,
    ),

  rain: (size = 20) =>
    wrap(
      `<path d="M7.4 15h9.3a3.9 3.9 0 0 0 .5-7.8 5.4 5.4 0 0 0-10.3-1A3.9 3.9 0 0 0 7.4 15Z" fill="#9aa8b4"/>
       <g stroke="#5fa8d0" stroke-width="1.8" stroke-linecap="round">
         <path d="M8.6 17.4 7.6 20M12 17.4 11 20M15.4 17.4 14.4 20"/>
       </g>`,
      size,
    ),

  storm: (size = 20) =>
    wrap(
      `<path d="M7.4 14h9.3a3.9 3.9 0 0 0 .5-7.8 5.4 5.4 0 0 0-10.3-1A3.9 3.9 0 0 0 7.4 14Z" fill="#7a838f"/>
       <path d="M12.6 14.2 9.4 19h2.4l-.8 3.4 3.6-5.2h-2.4l.4-3Z" fill="#f0c04a"/>`,
      size,
    ),

  fog: (size = 20) =>
    wrap(
      `<g stroke="#b6c2c9" stroke-width="2.1" stroke-linecap="round">
         <path d="M4 8.5h13M6.5 12h11.5M3.5 15.5h12M8 19h9"/>
       </g>`,
      size,
    ),

  heart: (size = 14, filled = true) =>
    wrap(
      filled
        ? `<path d="M12 20.4s-7.6-4.6-7.6-10A4.4 4.4 0 0 1 12 7.3a4.4 4.4 0 0 1 7.6 3.1c0 5.4-7.6 10-7.6 10Z" fill="#e0728a"/>`
        : `<path d="M12 20.4s-7.6-4.6-7.6-10A4.4 4.4 0 0 1 12 7.3a4.4 4.4 0 0 1 7.6 3.1c0 5.4-7.6 10-7.6 10Z" fill="none" stroke="#b9a8a0" stroke-width="1.8"/>`,
      size,
    ),

  star: (size = 16, filled = true) =>
    wrap(
      `<path d="m12 3.4 2.6 5.6 6.1.8-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.8l6.1-.8L12 3.4Z" fill="${filled ? '#e8a93c' : 'none'}" stroke="${filled ? 'none' : '#c0b6a8'}" stroke-width="1.7"/>`,
      size,
    ),

  bag: (size = 20) =>
    wrap(
      `<path d="M5.4 8.4h13.2l-1 11a1.8 1.8 0 0 1-1.8 1.6H8.2a1.8 1.8 0 0 1-1.8-1.6l-1-11Z" fill="#c08a56"/>
       <path d="M8.8 8.4V6.6a3.2 3.2 0 0 1 6.4 0v1.8" stroke="#8a6238" stroke-width="1.9" fill="none" stroke-linecap="round"/>
       <path d="M5.4 8.4h13.2l-.3 3H5.7l-.3-3Z" fill="#8a6238" opacity=".4"/>`,
      size,
    ),

  map: (size = 20) =>
    wrap(
      `<path d="M3.6 6.4 9 4.4v13.2l-5.4 2V6.4Z" fill="#8fbf6a"/>
       <path d="M9 4.4l6 2.2v13.2l-6-2.2V4.4Z" fill="#6f9a55"/>
       <path d="M15 6.6l5.4-2v13.2l-5.4 2V6.6Z" fill="#a8cf84"/>
       <path d="M6.2 11.4c1.6.6 2.8 2.2 3 4" stroke="#f4e8c8" stroke-width="1.4" fill="none" stroke-linecap="round"/>`,
      size,
    ),

  book: (size = 20) =>
    wrap(
      `<path d="M4.4 4.8h6.2c.9 0 1.6.7 1.6 1.6v13c-.5-.7-1.2-1-1.9-1H4.4V4.8Z" fill="#c9784f"/>
       <path d="M19.6 4.8h-6.2c-.9 0-1.6.7-1.6 1.6v13c.5-.7 1.2-1 1.9-1h5.9V4.8Z" fill="#e0946a"/>
       <path d="M12 6.4v13" stroke="#8a4a30" stroke-width="1.3"/>`,
      size,
    ),

  museum: (size = 20) =>
    wrap(
      `<path d="M12 3 3.2 8h17.6L12 3Z" fill="#7fa8c4"/>
       <g fill="#e8e0cd"><rect x="5" y="9.4" width="2.4" height="8" rx=".6"/><rect x="10.8" y="9.4" width="2.4" height="8" rx=".6"/><rect x="16.6" y="9.4" width="2.4" height="8" rx=".6"/></g>
       <rect x="3.2" y="18" width="17.6" height="2.4" rx=".8" fill="#7fa8c4"/>`,
      size,
    ),

  shop: (size = 20) =>
    wrap(
      `<path d="M4 9h16l-1 10.4a1.4 1.4 0 0 1-1.4 1.2H6.4A1.4 1.4 0 0 1 5 19.4L4 9Z" fill="#f0c98a"/>
       <path d="M3.4 5.4h17.2L20 9H4L3.4 5.4Z" fill="#c9784f"/>
       <path d="M9.4 12.6h5.2v8H9.4v-8Z" fill="#c9784f" opacity=".55"/>`,
      size,
    ),

  home: (size = 20) =>
    wrap(
      `<path d="m12 3.4 9 7.4h-2.6v9.4H5.6v-9.4H3l9-7.4Z" fill="#e8b98a"/>
       <path d="m12 3.4 9 7.4h-2.6L12 6l-6.4 4.8H3l9-7.4Z" fill="#c9784f"/>
       <rect x="10.2" y="14" width="3.6" height="6.2" rx=".7" fill="#8a6238"/>`,
      size,
    ),

  hammer: (size = 20) =>
    wrap(
      `<path d="m13.6 5.4 5 5-2.2 2.2-5-5 2.2-2.2Z" fill="#9aa4a8"/>
       <path d="m11 8.6 4.4 4.4-6.8 6.8a1.6 1.6 0 0 1-2.2 0l-2.2-2.2a1.6 1.6 0 0 1 0-2.2L11 8.6Z" fill="#b98a58"/>`,
      size,
    ),

  pot: (size = 20) =>
    wrap(
      `<path d="M4.6 9.6h14.8v5.6a4.4 4.4 0 0 1-4.4 4.4H9a4.4 4.4 0 0 1-4.4-4.4V9.6Z" fill="#7f8b91"/>
       <rect x="3" y="7.6" width="18" height="2.6" rx="1.3" fill="#9aa4a8"/>
       <path d="M9 5.6c0-1 1-1.4 1-2.4M12 5.6c0-1 1-1.4 1-2.4M15 5.6c0-1 1-1.4 1-2.4" stroke="#c9d2d6" stroke-width="1.4" stroke-linecap="round" fill="none"/>`,
      size,
    ),

  townhall: (size = 20) =>
    wrap(
      `<path d="M12 2.6 21 8v1.6H3V8l9-5.4Z" fill="#7fa86a"/>
       <rect x="4.6" y="10.6" width="14.8" height="8.4" rx="1" fill="#f0e2c4"/>
       <rect x="10.4" y="13.4" width="3.2" height="5.6" rx=".6" fill="#7fa86a"/>
       <rect x="3" y="19.4" width="18" height="2" rx=".8" fill="#c9bda2"/>`,
      size,
    ),

  rod: (size = 24) =>
    wrap(
      `<path d="M5 20 18 5" stroke="#a8763f" stroke-width="2.2" stroke-linecap="round"/>
       <circle cx="8.6" cy="16" r="2" fill="#9aa4a8"/>
       <path d="M18 5c1.6 3 1 6.4-1.6 8.6" stroke="#5c6a6b" stroke-width="1.2" fill="none" stroke-linecap="round"/>
       <circle cx="16" cy="14.4" r="1.6" fill="#e0574f"/>`,
      size,
    ),

  net: (size = 24) =>
    wrap(
      `<path d="M5 20 12 13" stroke="#a8763f" stroke-width="2.2" stroke-linecap="round"/>
       <circle cx="15.4" cy="9.6" r="5.2" stroke="#9aa4a8" stroke-width="2" fill="rgba(255,255,255,.35)"/>
       <path d="M11.4 7.2c2 1 4.4 2.6 6 4.6M13.4 5.4c1.6 1 3.6 2.8 4.8 4.6" stroke="#c9d2d6" stroke-width="1" fill="none"/>`,
      size,
    ),

  shovel: (size = 24) =>
    wrap(
      `<path d="M12 4v9" stroke="#a8763f" stroke-width="2.4" stroke-linecap="round"/>
       <path d="M9.6 4h4.8" stroke="#a8763f" stroke-width="2.2" stroke-linecap="round"/>
       <path d="M9 13h6l-1.2 5.4a1.9 1.9 0 0 1-3.6 0L9 13Z" fill="#9aa4a8"/>`,
      size,
    ),

  axe: (size = 24) =>
    wrap(
      `<path d="m7 19 8-11" stroke="#a8763f" stroke-width="2.4" stroke-linecap="round"/>
       <path d="M13.4 4.6c3.4.4 5.8 2.8 6.2 6.2-3 1.2-5.6.4-7.8-2.4 1-1.6 1.4-2.8 1.6-3.8Z" fill="#9aa4a8"/>`,
      size,
    ),

  can: (size = 24) =>
    wrap(
      `<rect x="5.4" y="9" width="9.2" height="9" rx="2" fill="#9aa4a8"/>
       <path d="M14.6 11.4 19 8.6l1.4 2-4.2 3.2" fill="#9aa4a8"/>
       <path d="M7.4 9c0-1.6 1.4-2.6 2.6-2.6s2.6 1 2.6 2.6" stroke="#c9d2d6" stroke-width="1.6" fill="none"/>
       <g stroke="#7fc9de" stroke-width="1.4" stroke-linecap="round"><path d="M18.6 13.6 18 16M20.4 14 20 16.4"/></g>`,
      size,
    ),

  leaf: (size = 76) =>
    wrap(
      `<path d="M40 6C22 10 8 24 8 42c0 12 8 22 20 24 2-20 12-36 30-48-8 18-14 34-16 48 16-4 26-18 26-36C68 16 56 8 40 6Z" fill="#6f9a55"/>
       <path d="M38 66c2-14 8-30 16-48-18 12-28 28-30 48" fill="#8fbf6a"/>`,
      size,
      '0 0 76 76',
    ),

  close: (size = 18) =>
    wrap(`<path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>`, size),

  chevron: (size = 16) =>
    wrap(`<path d="m9 5 7 7-7 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`, size),
};

export const WEATHER_ICONS: Record<string, (size?: number) => string> = {
  clear: Icons.sun,
  cloudy: Icons.cloud,
  rain: Icons.rain,
  storm: Icons.storm,
  fog: Icons.fog,
};

export const TOOL_ICONS: Record<string, (size?: number) => string> = {
  rod: Icons.rod,
  net: Icons.net,
  shovel: Icons.shovel,
  axe: Icons.axe,
  wateringCan: Icons.can,
};

export const RARITY_COLORS: Record<string, string> = {
  common: 'var(--rarity-common)',
  uncommon: 'var(--rarity-uncommon)',
  rare: 'var(--rarity-rare)',
  legendary: 'var(--rarity-legendary)',
  crafted: 'var(--rarity-crafted)',
};
