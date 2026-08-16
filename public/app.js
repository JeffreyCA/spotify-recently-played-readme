'use strict';

/**
 * Configurator for the README widget. Deliberately dependency-free and
 * build-step-free: it is one page whose entire job is to assemble a URL string,
 * so a framework and a bundler would be pure overhead.
 */

/** Mirrors isValidUserId on the server. */
const USER_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** Mirrors parseHexColor on the server: hex digits only, no leading hash. */
const HEX_RE = /^([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

const DEFAULTS = {
  theme: 'dark',
  count: 5,
  width: 400,
  radius: 10,
  art: true,
  header: true,
  time: true,
  logo: true,
  profile: 'header',
  username: 'display',
  avatar: true,
  footer: 'off',
  unique: false,
  now_playing: true,
  progress: true,
  duration: false,
  explicit: true,
  album: false,
};

/** Every boolean control, so the reader and the URL builder cannot diverge. */
const FLAGS = [
  'art',
  'header',
  'time',
  'logo',
  'avatar',
  'unique',
  'now_playing',
  'progress',
  'duration',
  'explicit',
  'album',
];

/**
 * Each color control: its element id prefix, its URL parameter, and where its
 * default comes from - a theme field, or a fixed value for the logo, which is a
 * trademark rather than part of any palette. One table so the swatches, resets,
 * values and URL builder cannot disagree about what a field means.
 */
const COLORS = [
  { id: 'bg-color', param: 'bg_color', themeKey: 'bg' },
  { id: 'text-color', param: 'text_color', themeKey: 'title' },
  { id: 'artist-color', param: 'artist_color', themeKey: 'artist' },
  { id: 'meta-color', param: 'meta_color', themeKey: 'meta' },
  { id: 'accent-color', param: 'accent_color', themeKey: 'accent' },
  { id: 'logo-color', param: 'logo_color', fixed: '#1db954' },
];

const COLOR_BY_PARAM = new Map(COLORS.map((c) => [c.param, c]));
const COLOR_PARAMS = new Set(COLORS.map((c) => c.param));

const MIN_CONTRAST = 4.5;

/**
 * Each theme's settable colors, mirrored from src/render/themes.ts so a swatch
 * can show what is actually rendering. Update both together, or an untouched
 * picker shows a color the card is not using. `transparent` has no background,
 * so it seeds from the page it is usually laid over.
 */
const THEME_COLORS = {
  dark: {
    bg: '#151b23',
    title: '#e9eef5',
    artist: '#9fadbd',
    meta: '#7d8b9c',
    accent: '#1db954',
  },
  spotify: {
    bg: '#121212',
    title: '#ffffff',
    artist: '#b3b3b3',
    meta: '#8a8a8a',
    accent: '#1db954',
  },
  legacy: {
    bg: '#212121',
    title: '#f0f0f0',
    artist: '#b0b0b0',
    meta: '#8a8a8a',
    accent: '#1db954',
  },
  radical: {
    bg: '#141322',
    title: '#d0fff4',
    artist: '#f37ab0',
    meta: '#7c9c9e',
    accent: '#ff428e',
  },
  light: {
    bg: '#ffffff',
    title: '#1f2328',
    artist: '#59636e',
    meta: '#818b98',
    accent: '#137a3f',
  },
  nord: {
    bg: '#2e3440',
    title: '#eceff4',
    artist: '#88c0d0',
    meta: '#7b88a1',
    accent: '#88c0d0',
  },
  catppuccin: {
    bg: '#1e1e2e',
    title: '#cdd6f4',
    artist: '#cba6f7',
    meta: '#7f849c',
    accent: '#a6e3a1',
  },
  transparent: {
    bg: '#0d1117',
    title: '#8b949e',
    artist: '#8b949e',
    meta: '#6e7681',
    accent: '#1db954',
  },
  dracula: {
    bg: '#282a36',
    title: '#f8f8f2',
    artist: '#bd93f9',
    meta: '#808db4',
    accent: '#50fa7b',
  },
  tokyonight: {
    bg: '#1a1b26',
    title: '#c0caf5',
    artist: '#7aa2f7',
    meta: '#767fa9',
    accent: '#9ece6a',
  },
};

const el = (id) => document.getElementById(id);

const controls = {
  user: el('user'),
  theme: el('theme'),
  bg_color: el('bg-color'),
  text_color: el('text-color'),
  artist_color: el('artist-color'),
  meta_color: el('meta-color'),
  accent_color: el('accent-color'),
  logo_color: el('logo-color'),
  count: el('count'),
  width: el('width'),
  radius: el('radius'),
  art: el('art'),
  header: el('header'),
  time: el('time'),
  logo: el('logo'),
  profile: el('profile'),
  username: el('username'),
  avatar: el('avatar'),
  footer: el('footer'),
  unique: el('unique'),
  now_playing: el('now_playing'),
  progress: el('progress'),
  duration: el('duration'),
  explicit: el('explicit'),
  album: el('album'),
};

const out = {
  count: el('count-out'),
  width: el('width-out'),
  radius: el('radius-out'),
  snippet: el('snippet-out'),
  url: el('url-out'),
  userError: el('user-error'),
  colorStatus: el('color-status'),
  colorCount: el('color-count'),
  preview: el('preview'),
  previewEmpty: el('preview-empty'),
  scopeNote: el('scope-note'),
  copy: el('copy'),
  copyUrl: el('copy-url'),
  account: el('account'),
  accountStatusText: el('account-status-text'),
  accountHint: el('account-hint'),
  connect: el('connect'),
  disconnect: el('disconnect'),
  manualToggle: el('manual-toggle'),
  manualField: el('manual-field'),
};

/*
 * Which account this browser last connected.
 *
 * The callback redirects here with `?user=`, and this remembers it - so nobody
 * has to know their own Spotify user ID, which is not a display name and for a
 * social signup is a string they have never seen.
 */
const STORAGE_KEY = 'spotify-recently-played:user';

function readStoredUser() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored && USER_RE.test(stored) ? stored : null;
  } catch {
    // Private mode, or storage disabled. The URL still works.
    return null;
  }
}

function storeUser(value) {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* not worth reporting */
  }
}

/** True once the user has typed a name themselves rather than being handed one. */
let manualOpen = false;

/**
 * Reflects whether we know an account yet.
 *
 * Connected, the username is a fact rather than a question, so the field folds
 * away behind a link - it is still there for building someone else's card, but
 * it stops competing with the button that fills it in.
 */
function syncAccount(user) {
  const connected = USER_RE.test(user);

  out.account.dataset.connected = String(connected);
  out.accountStatusText.textContent = connected ? `Connected as ${user}` : 'Not connected';
  out.connect.textContent = connected ? 'Reconnect' : 'Connect with Spotify';
  out.connect.classList.toggle('primary', !connected);
  out.disconnect.hidden = !connected;
  out.accountHint.hidden = connected;

  out.manualToggle.textContent = connected
    ? 'Build a card for a different username'
    : 'Enter a username manually';

  // Stays closed unless asked for. Someone arriving here should take the
  // Connect path; the field is for building a card for another account.
  const open = manualOpen;
  out.manualField.hidden = !open;
  out.manualToggle.setAttribute('aria-expanded', String(open));
}

let activeTab = 'markdown';

/**
 * The color fields a user has actually set.
 *
 * Tracked rather than inferred by comparing against the theme, because the
 * fields are filled in with the theme's own values: a comparison cannot tell
 * "untouched" from "deliberately set to the same color", and every field would
 * turn custom the moment the theme changed under it.
 */
const customized = new Set();

function readState() {
  const state = {
    user: controls.user.value.trim(),
    theme: controls.theme.value,
    count: Number(controls.count.value),
    width: Number(controls.width.value),
    radius: Number(controls.radius.value),
    profile: controls.profile.value,
    username: controls.username.value,
    footer: controls.footer.value,
  };

  for (const name of FLAGS) state[name] = controls[name].checked;

  for (const { param } of COLORS) {
    state[param] = controls[param].value.trim().toLowerCase().replace(/^#/, '');
  }

  return state;
}

/** Builds the widget URL, omitting anything left at its default to keep it short. */
function buildUrl(state, overrides = {}) {
  const merged = { ...state, ...overrides };
  const params = new URLSearchParams();
  params.set('user', merged.user);

  const forceTheme = Object.prototype.hasOwnProperty.call(overrides, 'theme');
  if (forceTheme || merged.theme !== DEFAULTS.theme) params.set('theme', merged.theme);

  for (const name of ['count', 'width', 'radius']) {
    if (merged[name] !== DEFAULTS[name]) params.set(name, String(merged[name]));
  }

  for (const name of FLAGS) {
    if (merged[name] !== DEFAULTS[name]) params.set(name, merged[name] ? '1' : '0');
  }

  if (merged.profile !== DEFAULTS.profile) params.set('profile', merged.profile);
  if (merged.username !== DEFAULTS.username) params.set('username', merged.username);
  // A footer profile *is* the footer, so an extra `footer` would be dead weight.
  if (merged.footer !== DEFAULTS.footer && !merged.profile.startsWith('footer-')) {
    params.set('footer', merged.footer);
  }

  // Only colors that differ from the theme, so the fields can sit filled in
  // without every card carrying five redundant parameters.
  for (const { param } of COLORS) {
    if (HEX_RE.test(merged[param]) && isCustom(param, merged)) params.set(param, merged[param]);
  }

  return `${location.origin}/svg?${params.toString()}`;
}

/** In HTML attributes an unescaped `&` is a malformed entity; escape it. */
const attr = (url) => url.replace(/&/g, '&amp;');

function buildSnippet(state) {
  const url = buildUrl(state);
  const profile = `https://open.spotify.com/user/${encodeURIComponent(state.user)}`;
  const alt = 'Spotify recently played';

  switch (activeTab) {
    case 'linked':
      return `[![${alt}](${url})](${profile})`;

    case 'html':
      return `<a href="${profile}">\n  <img src="${attr(url)}" alt="${alt}" width="${state.width}" />\n</a>`;

    case 'adaptive': {
      const dark = attr(buildUrl(state, { theme: 'dark' }));
      const light = attr(buildUrl(state, { theme: 'light' }));
      return [
        '<picture>',
        `  <source media="(prefers-color-scheme: dark)" srcset="${dark}" />`,
        `  <source media="(prefers-color-scheme: light)" srcset="${light}" />`,
        `  <img src="${dark}" alt="${alt}" width="${state.width}" />`,
        '</picture>',
      ].join('\n');
    }

    case 'markdown':
    default:
      return `![${alt}](${url})`;
  }
}

let previewTimer = null;

function schedulePreview(url) {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    out.preview.src = url;
    out.preview.hidden = false;
    out.previewEmpty.hidden = true;
  }, 300);
}

/* -------------------------------------------------------------------------- */
/* Colors                                                                      */
/* -------------------------------------------------------------------------- */

/*
 * A small mirror of src/render/color.ts, duplicated because this page has no
 * build step. It drives the swatches, field values and contrast readout only -
 * the rendered card always comes from the Worker.
 */

/** Expands the short forms, so a swatch can be seeded from any accepted hex. */
function toSixDigit(value) {
  if (!HEX_RE.test(value)) return null;
  const hex = value.length <= 4 ? [...value].map((c) => c + c).join('') : value;
  return `#${hex.slice(0, 6)}`;
}

function channels(sixDigit) {
  return [1, 3, 5].map((i) => Number.parseInt(sixDigit.slice(i, i + 2), 16));
}

/** WCAG relative luminance. */
function luminance(sixDigit) {
  const [r, g, b] = channels(sixDigit).map((raw) => {
    const c = raw / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function themeColors(theme) {
  return THEME_COLORS[theme] ?? THEME_COLORS.dark;
}

/**
 * The color a field falls back to, as `#rrggbb`, or null where the theme has
 * none to offer - only `transparent`'s background, which the card does not draw.
 */
function themeDefault(param, state) {
  const { themeKey, fixed } = COLOR_BY_PARAM.get(param);
  if (fixed) return fixed;
  if (param === 'bg_color' && state.theme === 'transparent') return null;
  return themeColors(state.theme)[themeKey];
}

/** What the card will use for a color, given what is typed and which theme. */
function effectiveColor(param, state) {
  return toSixDigit(state[param]) ?? themeDefault(param, state) ?? themeColors(state.theme).bg;
}

/** Whether a field is carrying anything other than its theme default. */
function isCustom(param, state) {
  if (!customized.has(param)) return false;
  return state[param] !== '' && HEX_RE.test(state[param]);
}

/**
 * Swatches currently mid-drag.
 *
 * A native picker fires `input` continuously while it is open, and writing to
 * `value` during that fights the control. This used to be guarded with
 * `document.activeElement !== swatch`, which is not the same question: a color
 * input can keep focus after its picker has closed, and then the swatch stopped
 * following the field entirely - Reset appeared to update the text and not the
 * color until it was clicked a second time.
 */
const dragging = new Set();

/**
 * Writes the state back onto the color controls: swatches, values, validity and
 * the contrast readout.
 *
 * Contrast warns rather than blocks. Low contrast can be deliberate, and the
 * server quietly rescues unreadable combinations - saying nothing would make
 * that look like the color being ignored.
 */
function syncColors(state) {
  let invalid = 0;

  for (const { id, param } of COLORS) {
    const raw = state[param];
    const bad = raw !== '' && !HEX_RE.test(raw);
    if (bad) invalid++;

    const input = controls[param];
    input.setAttribute('aria-invalid', String(bad));

    // Fields carry the value the card is using rather than a placeholder, so a
    // theme's palette can be read and copied straight out.
    const fallback = themeDefault(param, state);
    if (!customized.has(param)) input.value = fallback ? fallback.slice(1) : '';
    input.placeholder = fallback ? '' : 'none';

    const custom = isCustom(param, state);
    const row = document.querySelector(`.color-row[data-color="${id}"]`);
    row.dataset.unset = String(!custom);

    // Nothing to reset when the field already matches the theme, and offering
    // it anyway is what made Reset look broken.
    document.querySelector(`.reset[data-reset="${id}"]`).disabled = !custom;

    // A chequer means transparency, which only 4- and 8-digit hex carries.
    row.querySelector('.swatch-wrap').dataset.alpha = String(raw.length === 4 || raw.length === 8);

    if (!dragging.has(param)) el(`${id}-swatch`).value = effectiveColor(param, state);
  }

  if (invalid > 0) {
    out.colorStatus.dataset.level = 'error';
    out.colorStatus.textContent = 'Hex digits only, e.g. 121212 or 121212cc';
    return;
  }

  const ratio = contrast(effectiveColor('bg_color', state), effectiveColor('text_color', state));
  const readable = ratio >= MIN_CONTRAST;
  out.colorStatus.dataset.level = readable ? 'ok' : 'warn';
  out.colorStatus.textContent = readable
    ? `Text contrast ${ratio.toFixed(1)}:1`
    : `Text contrast ${ratio.toFixed(1)}:1 - the card will adjust the text to stay readable.`;
}

/**
 * Counts the colors in play on the collapsed section's summary, so customising
 * one is not hidden by closing it.
 */
function updateColorBadge(state) {
  const set = COLORS.filter(({ param }) => isCustom(param, state)).length;
  out.colorCount.hidden = set === 0;
  out.colorCount.textContent = String(set);
}

function render() {
  const state = readState();

  out.count.textContent = String(state.count);
  out.width.textContent = String(state.width);
  out.radius.textContent = String(state.radius);

  const valid = USER_RE.test(state.user);
  const empty = state.user === '';

  syncAccount(state.user);

  controls.user.setAttribute('aria-invalid', String(!empty && !valid));
  // Only say something when something is wrong.
  out.userError.textContent = empty || valid ? '' : 'Letters, digits, - and _ only';

  syncColors(state);
  updateColorBadge(state);

  // The footer holds one thing. If the profile is down there, it is the footer.
  controls.footer.disabled = state.profile.startsWith('footer-');
  // Both only mean anything against the profile and the live row respectively.
  controls.username.disabled = state.profile === 'off';
  controls.avatar.disabled = state.profile === 'off';
  controls.progress.disabled = !state.now_playing;

  // Accounts authorized against the old Vercel app granted only
  // `user-read-recently-played`, so the card silently drops the live row for
  // them. Silently is right for the card and wrong for this page.
  out.scopeNote.hidden = !state.now_playing;

  if (!valid) {
    out.snippet.textContent = empty ? 'Connect your account to get a snippet' : 'Enter a username';
    out.url.textContent = '-';
    out.copy.disabled = true;
    out.copyUrl.disabled = true;
    out.preview.hidden = true;
    out.previewEmpty.hidden = false;
    clearTimeout(previewTimer);
    return;
  }

  const url = buildUrl(state);
  out.snippet.textContent = buildSnippet(state);
  out.url.textContent = url;
  out.copy.disabled = false;
  out.copyUrl.disabled = false;
  schedulePreview(url);
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard API needs a secure context; fall back to a hidden textarea.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } finally {
      document.body.removeChild(ta);
    }
  }

  const original = button.textContent;
  button.textContent = 'Copied';
  button.classList.add('copied');
  setTimeout(() => {
    button.textContent = original;
    button.classList.remove('copied');
  }, 1400);
}

for (const [name, control] of Object.entries(controls)) {
  // A color field claims itself as the user's before anything re-renders from
  // it - otherwise the render would overwrite what was just typed.
  if (COLOR_PARAMS.has(name)) {
    control.addEventListener('input', () => {
      if (control.value.trim() === '') customized.delete(name);
      else customized.add(name);
    });
  }
  control.addEventListener('input', render);
  control.addEventListener('change', render);
}

/*
 * Swatches commit on `change`, not `input`: a native picker fires `input`
 * continuously while dragging, and every preview is a request to the Worker.
 * `input` is still listened to, but only to mark the picker as in use so the
 * render loop leaves it alone until it closes.
 */
for (const { id, param } of COLORS) {
  const swatch = el(`${id}-swatch`);

  swatch.addEventListener('input', () => dragging.add(param));

  swatch.addEventListener('change', () => {
    dragging.delete(param);
    controls[param].value = swatch.value.replace(/^#/, '');
    customized.add(param);
    render();
  });

  // Resetting hands the field back to the theme; the next render fills it with
  // the theme's own value, which then stays out of the URL.
  document.querySelector(`.reset[data-reset="${id}"]`).addEventListener('click', () => {
    dragging.delete(param);
    customized.delete(param);
    render();
    controls[param].focus();
  });
}

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => {
    activeTab = tab.dataset.tab;
    for (const other of document.querySelectorAll('.tab')) {
      other.setAttribute('aria-selected', String(other === tab));
    }
    render();
  });
}

out.copy.addEventListener('click', () => copyText(out.snippet.textContent, out.copy));
out.copyUrl.addEventListener('click', () => copyText(out.url.textContent, out.copyUrl));

out.manualToggle.addEventListener('click', () => {
  manualOpen = out.manualField.hidden;
  render();
  if (manualOpen) controls.user.focus();
});

/*
 * The username arrives from the callback (`/?user=…`) and is remembered from
 * then on, so nobody has to know their own Spotify user ID - which for a
 * Google, Facebook or Apple signup is an opaque string they have never seen.
 * The manual field stays as an escape hatch for building someone else's card.
 */
const fromQuery = new URLSearchParams(location.search).get('user');
if (fromQuery && USER_RE.test(fromQuery)) {
  controls.user.value = fromQuery;
  storeUser(fromQuery);
} else {
  const remembered = readStoredUser();
  if (remembered) controls.user.value = remembered;
}

render();
