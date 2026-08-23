import { footerProfileAlign, type WidgetOptions } from '../options';
import type { NowPlaying, PlayHistoryItem, Profile, Track } from '../spotify';
import { waveDecor } from './decor';
import { escapeCss, escapeXml } from './escape';
import { FONT_STACK } from './font';
import {
  avatarPlaceholder,
  discPlaceholder,
  explicitBadge,
  logoAscent,
  logoDescent,
  logoHeightForCap,
  logoWidth,
  SPOTIFY_GREEN,
  spotifyLogo,
} from './icons';
import {
  estimateLayoutWidth,
  estimateWidth,
  truncateToWidth,
} from './measure';
import { resolveTheme, type Theme } from './themes';

/* -------------------------------------------------------------------------- */
/* Type metrics                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Metrics for the system font stack, as a fraction of font size.
 *
 * SVG positions text by baseline, but a reader aligns things by what they can
 * see. Measured from the resolved stack rather than estimated: Canvas
 * TextMetrics at 1000px gives cap 0.7031 and descender 0.2344.
 */
const CAP_RATIO = 0.7031;
const DESC_RATIO = 0.2344;

/** Baseline that puts the optical centre of a line of `size` on `centreY`. */
function centredBaseline(centreY: number, size: number): number {
  return centreY + ((CAP_RATIO - DESC_RATIO) / 2) * size;
}

/**
 * Optical centre of a line of text: midway between its cap height and its
 * baseline. Descenders hang below a line rather than belonging to it, so
 * centring against the full ink extent puts adjacent glyphs visibly low.
 */
function capCentre(baseline: number, size: number): number {
  return baseline - (CAP_RATIO * size) / 2;
}

/* -------------------------------------------------------------------------- */
/* Layout                                                                     */
/* -------------------------------------------------------------------------- */

const PAD_X = 16;

/**
 * The single constant governing vertical rhythm.
 *
 * The card is a stack of sections divided by hairline rules. Every section
 * keeps exactly this much clearance from its boundary, whether that boundary
 * is a rule or the card edge. Adding a second general spacing constant is how
 * the rhythm comes apart.
 */
const SECTION_PAD = 12;

const TITLE_SIZE = 14;
const ARTIST_SIZE = 13;
/** Right-hand meta: timestamp, duration, "Listening now". */
const META_SIZE = 11.5;

/** Baseline-to-baseline distance between the title and artist lines. */
const LINE_GAP = 19;

/**
 * The art tile is as tall as the text block's full ink, from the title's cap
 * height to the artist's descender. Derived rather than chosen: pick a size
 * independently and the two drift apart whenever a font size changes.
 */
const ART_SIZE = Math.round(CAP_RATIO * TITLE_SIZE + LINE_GAP + DESC_RATIO * ARTIST_SIZE);
const ART_GAP = 12;

/**
 * Where the title's baseline sits within the row.
 *
 * A text block reads as running from the first line's cap height to the last
 * line's *baseline*: descenders are perceived as hanging below it, not as part
 * of it. So that extent - not the ink extent - is what gets centred on the tile.
 */
const TITLE_BASELINE_IN_ROW = ART_SIZE / 2 - (LINE_GAP - CAP_RATIO * TITLE_SIZE) / 2;

/** Rows are the same height with or without art, so the rhythm never jumps. */
const ROW_H = ART_SIZE;

const HEADER_TITLE_SIZE = 16;
const USER_SIZE = 12.5;
const AVATAR_SIZE = 24;
/**
 * Sized so the "Spotify" glyphs match the header title's cap height - the
 * only reading of "same size as the title" that survives a font-size change.
 * Lands at ~24.3 against a 16px title.
 */
const LOGO_H = logoHeightForCap(CAP_RATIO * HEADER_TITLE_SIZE);
const LOGO_GAP = 7;
const AVATAR_GAP = 5;

const EXPLICIT_SIZE = 11;
/** The badge glyph is a solid block, so it needs less air than a letterform. */
const EXPLICIT_GAP = 5;

const EQ_BARS = 3;
const EQ_BAR_W = 3;
const EQ_BAR_GAP = 2;
const EQ_H = 11;
const EQ_WIDTH = EQ_BARS * (EQ_BAR_W + EQ_BAR_GAP) - EQ_BAR_GAP;
/** Space between the equaliser and the "Listening now" label. */
const EQ_TEXT_GAP = 6;

/** The now-playing progress bar, drawn below the row it belongs to. */
const PROGRESS_H = 3;
const PROGRESS_TOP_GAP = 10;


/** Height of the wave footer, and the smaller pad below it: the band already
 *  carries slack because the dots never reach its edges. */
const FOOTER_WAVE_H = 30;
const FOOTER_WAVE_PAD = 4;

/** Separates the pieces of the right-hand meta line. */
const META_SEPARATOR = ' \u00b7 ';

/** Art is fetched at this display size; exported so the fetcher stays in sync. */
export const ART_DISPLAY_PX = ART_SIZE;
export const AVATAR_DISPLAY_PX = AVATAR_SIZE;

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

export interface CardInput {
  options: WidgetOptions;
  items: PlayHistoryItem[];
  /** Parallel to `items`; null where art was unavailable. */
  art: (string | null)[];
  /** The live track, when one was asked for and Spotify returned one. */
  nowPlaying?: NowPlaying | null;
  nowPlayingArt?: string | null;
  /** Profile data, when `avatar` or `username` is enabled. */
  profile?: Profile | null;
  /** Inlined avatar data URI, or null to fall back to the placeholder. */
  avatarImage?: string | null;
  /** Injectable for deterministic tests. */
  now?: number;
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
/** Average lengths, so "1mo" means a month rather than exactly 30 days. */
const MONTH = 2629800;
const YEAR = 12 * MONTH;

/**
 * Always relative, never an absolute date.
 *
 * An absolute date would be ambiguous anyway: the card is rendered server-side
 * with no knowledge of the reader's timezone or locale, so "Jul 20" could be
 * off by a day and would read as US-formatted to everyone.
 */
export function relativeTime(playedAtSeconds: number, nowMs: number): string {
  const diff = Math.max(0, Math.floor(nowMs / 1000) - playedAtSeconds);

  if (diff < MINUTE) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < WEEK) return `${Math.floor(diff / DAY)}d ago`;
  if (diff < MONTH) return `${Math.floor(diff / WEEK)}w ago`;
  if (diff < YEAR) return `${Math.floor(diff / MONTH)}mo ago`;
  return `${Math.floor(diff / YEAR)}y ago`;
}

/** 222000 -> "3:42". Hours appear only when a track actually runs that long. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);

  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  return `${hours > 0 ? `${hours}:` : ''}${mm}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Only ever emit links to Spotify over https.
 *
 * The URL arrives in the upstream payload, so treating it as trusted would let
 * anything Spotify returned - or anything injected into a cached response -
 * become a `javascript:` href in the rendered card.
 */
export function safeSpotifyUrl(raw: string): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    if (url.username !== '' || url.password !== '') return null;
    if (url.hostname !== 'open.spotify.com') return null;
    return url.toString();
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Primitives                                                                 */
/* -------------------------------------------------------------------------- */

interface TextOptions {
  size: number;
  fill: string;
  weight?: number;
  anchor?: 'start' | 'end';
  className?: string;
  /**
   * Pins the rendered advance to the width used by adjacent non-text layout.
   */
  textLength?: number;
}

/** Every piece of text in the card goes through here, so escaping is uniform. */
function text(
  content: string,
  x: number,
  baseline: number,
  { size, fill, weight, anchor, className, textLength }: TextOptions,
): string {
  return (
    `<text${className ? ` class="${className}"` : ''} x="${round(x)}" y="${round(baseline)}"` +
    `${anchor === 'end' ? ' text-anchor="end"' : ''}` +
    ` font-family="${FONT_STACK}" font-size="${size}"` +
    `${weight ? ` font-weight="${weight}"` : ''}` +
    `${textLength !== undefined ? ` textLength="${round(textLength)}" lengthAdjust="spacing"` : ''}` +
    ` fill="${fill}">${escapeXml(content)}</text>`
  );
}

function link(href: string, body: string, className: string, label?: string): string {
  return (
    `<a class="${className}" href="${escapeXml(href)}" target="_blank" rel="noopener noreferrer"` +
    `${label ? ` aria-label="${escapeXml(label)}"` : ''}>${body}</a>`
  );
}

/**
 * Wraps `body` so hovering it shows `tip`.
 *
 * A `<title>` has to be the first child of the element it describes, and it is
 * inert inside an `<img>` - so, like the links, this only resolves when the SVG
 * is opened directly or inlined. Newlines survive into the tooltip.
 */
function tooltip(tip: string, body: string): string {
  return `<g><title>${escapeXml(tip)}</title>${body}</g>`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * `Played Aug 16, 2026 at 17:30 UTC`.
 *
 * UTC and stated as such: the card is rendered server-side with no knowledge of
 * the reader's timezone, and an unlabelled local-looking time would be wrong
 * for almost everyone. The visible label stays relative for the same reason.
 */
export function absoluteTime(playedAtSeconds: number): string {
  const d = new Date(playedAtSeconds * 1000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `Played ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} at ${hh}:${mm} UTC`;
}

/** `{track}\nby {artists}\nfrom {album}`, dropping the album when there is none. */
export function trackTooltip(track: Track): string {
  const lines = [track.name, `by ${track.artists.join(', ')}`];
  if (track.album) lines.push(`from ${track.album}`);
  return lines.join('\n');
}

/** Hairline rule spanning the content width, centred on `y`. */
function rule(y: number, width: number, color: string): string {
  return `<rect x="${PAD_X}" y="${round(y - 0.5)}" width="${width - PAD_X * 2}" height="1" fill="${color}"/>`;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Three bars. The staggered delays keep them from moving as one block. */
function equaliser(x: number, baseline: number, color: string, idPrefix: string): string {
  const delays = [0, 300, 150];
  const bars = delays
    .map((delay, i) => {
      const bx = x + i * (EQ_BAR_W + EQ_BAR_GAP);
      return (
        `<rect class="${idPrefix}-eq" x="${round(bx)}" y="${round(baseline - EQ_H)}"` +
        ` width="${EQ_BAR_W}" height="${EQ_H}" rx="1.5" fill="${color}" style="animation-delay:${delay}ms"/>`
      );
    })
    .join('');
  return `<g>${bars}</g>`;
}

function artTile(dataUri: string | null, x: number, y: number, ctx: Ctx, index: number): string {
  if (!dataUri) {
    return discPlaceholder(x, y, ART_SIZE, ctx.theme.placeholder, ctx.theme.placeholderInk);
  }
  const clipId = `${ctx.idPrefix}-clip${index}`;
  return (
    `<clipPath id="${clipId}"><rect x="${x}" y="${round(y)}" width="${ART_SIZE}" height="${ART_SIZE}" rx="4"/></clipPath>` +
    `<image x="${x}" y="${round(y)}" width="${ART_SIZE}" height="${ART_SIZE}" href="${dataUri}" clip-path="url(#${clipId})" preserveAspectRatio="xMidYMid slice"/>`
  );
}

function avatarTile(dataUri: string | null, cx: number, cy: number, ctx: Ctx): string {
  if (!dataUri) {
    return avatarPlaceholder(cx, cy, AVATAR_SIZE, ctx.theme.placeholder, ctx.theme.placeholderInk);
  }
  const clipId = `${ctx.idPrefix}-avatar`;
  const r = AVATAR_SIZE / 2;
  return (
    `<clipPath id="${clipId}"><circle cx="${round(cx)}" cy="${round(cy)}" r="${r}"/></clipPath>` +
    `<image x="${round(cx - r)}" y="${round(cy - r)}" width="${AVATAR_SIZE}" height="${AVATAR_SIZE}" href="${dataUri}" clip-path="url(#${clipId})" preserveAspectRatio="xMidYMid slice"/>`
  );
}

/* -------------------------------------------------------------------------- */
/* Sections                                                                   */
/* -------------------------------------------------------------------------- */

/** A section's markup together with the height it consumed. */
interface Section {
  svg: string;
  height: number;
}

const EMPTY_SECTION: Section = { svg: '', height: 0 };

/** Values shared by every section, resolved once per render. */
interface Ctx {
  options: WidgetOptions;
  theme: Theme;
  idPrefix: string;
  width: number;
  /** x of the right content edge. */
  rightEdge: number;
  /** x where the title/artist column starts, after any artwork. */
  textX: number;
  profileHref: string;
  /** What the profile calls the account: the display name, or the user ID. */
  profileName: string;
  /** Fraction 0-1 the progress bar starts at, or null when there is none. */
  progressFrom: number | null;
  /** Milliseconds left in the live track, for the progress animation. */
  progressRemainingMs: number;
}

/**
 * Visual bounds of the header's contents relative to its shared text baseline.
 *
 * Symmetric about the title's cap-to-baseline centre, not the union of
 * everything's ink - those differ visibly: the avatar hangs ~9px below the
 * baseline while nothing reaches as far above it, so centring the union
 * dragged the whole band down, leaving the title riding ~1.1px high whenever
 * a picture was shown - and only then, so it read as a jump when the option
 * was toggled.
 *
 * Cap-to-baseline centring matches the rule the rows already use: a descender
 * reads as overhang, not part of the line. Everything else is then bounded by
 * the largest reach in either direction, keeping at least SECTION_PAD of
 * clearance around the lot.
 */
function headerExtent(options: WidgetOptions): { top: number; bottom: number } {
  const showsName = options.profile === 'header' && options.username !== 'off';
  const showsAvatar = options.profile === 'header' && options.avatar;

  const centre = -(CAP_RATIO * HEADER_TITLE_SIZE) / 2;

  // [top, bottom] of each element, relative to the shared baseline. Text
  // contributes its cap-to-baseline extent for the reason above.
  const spans: Array<[number, number]> = [[-CAP_RATIO * HEADER_TITLE_SIZE, 0]];

  if (showsName) spans.push([-CAP_RATIO * USER_SIZE, 0]);

  // The wordmark sits on the baseline, so the circle overhangs it both ways.
  if (options.logo) spans.push([-logoAscent(LOGO_H), logoDescent(LOGO_H)]);

  // Centred on the band's own centre line, so it reaches equally either way.
  if (showsAvatar) spans.push([centre - AVATAR_SIZE / 2, centre + AVATAR_SIZE / 2]);

  let half = 0;
  for (const [top, bottom] of spans) {
    half = Math.max(half, centre - top, bottom - centre);
  }

  return { top: centre - half, bottom: centre + half };
}

function renderHeader(ctx: Ctx, baseline: number, avatarImage: string | null): string {
  const { theme, options, idPrefix, rightEdge } = ctx;
  const parts: string[] = [];

  // Right: the profile, when it lives here. `avatar` and `username` say what
  // it contains; `profile` says where it goes.
  const inHeader = options.profile === 'header';
  const showName = inHeader && options.username !== 'off';
  const showAvatar = inHeader && options.avatar;

  // Centred on the title's cap-to-baseline middle - the same line the band is
  // built around, and the rule the explicit badge also uses against a track
  // title. The name instead shares the baseline; it's small enough that tying
  // it to the title reads better than pulling the picture down to it.
  const avatarCentreY = capCentre(baseline, HEADER_TITLE_SIZE);

  const nameWidth = showName ? estimateWidth(ctx.profileName, USER_SIZE, 600) : 0;
  const avatarGap = showName && showAvatar ? AVATAR_GAP : 0;
  let rightUsed = nameWidth;

  let identity = '';
  if (showAvatar) {
    const cx = rightEdge - nameWidth - avatarGap - AVATAR_SIZE / 2;
    identity += avatarTile(avatarImage, cx, avatarCentreY, ctx);
    rightUsed += avatarGap + AVATAR_SIZE;
  }
  if (showName) {
    identity += text(ctx.profileName, rightEdge, baseline, {
      size: USER_SIZE,
      weight: 600,
      fill: theme.title,
      anchor: 'end',
      className: `${idPrefix}-u`,
      textLength: showAvatar ? nameWidth : undefined,
    });
  }
  if (identity) {
    // With no name the link carries no text, so it needs an explicit
    // accessible name.
    parts.push(
      link(
        ctx.profileHref,
        identity,
        `${idPrefix}-a`,
        showName ? undefined : `${ctx.profileName} on Spotify`,
      ),
    );
  }

  // Left: logo then title, sharing a baseline so they read as one line of
  // type.
  let titleX = PAD_X;
  if (options.logo) {
    parts.push(
      link(
        ctx.profileHref,
        spotifyLogo(PAD_X, baseline, LOGO_H, options.logoColor ?? SPOTIFY_GREEN, `${idPrefix}-g`),
        `${idPrefix}-a`,
        `${ctx.profileName} on Spotify`,
      ),
    );
    titleX = PAD_X + logoWidth(LOGO_H) + LOGO_GAP;
  }

  const available = rightEdge - titleX - rightUsed - 12;
  const headerTitle = truncateToWidth('Recently Played', HEADER_TITLE_SIZE, available, 600);
  parts.push(
    text(headerTitle, titleX, baseline, {
      size: HEADER_TITLE_SIZE,
      weight: 600,
      fill: theme.title,
      textLength:
        headerTitle !== 'Recently Played'
          ? estimateWidth(headerTitle, HEADER_TITLE_SIZE, 600)
          : undefined,
    }),
  );

  return parts.join('');
}

/** One list entry, whether it came from history or from the player. */
interface RowData {
  track: Track;
  /** Epoch seconds, or null for the live row. */
  playedAt: number | null;
  live: boolean;
}

/**
 * The right-hand meta line: duration then timestamp, joined by a middot.
 *
 * One line, not a column: the row is only two lines tall, and a stacked meta
 * block would fight the artist line for the same vertical space. Built as a
 * list, so a narrow card drops whole pieces instead of truncating a timestamp
 * into nonsense.
 */
function metaParts(options: WidgetOptions, row: RowData, now: number): string[] {
  const parts: string[] = [];
  if (options.duration && row.track.durationMs > 0) {
    parts.push(formatDuration(row.track.durationMs));
  }
  if (options.time && row.playedAt !== null) {
    parts.push(relativeTime(row.playedAt, now));
  }
  return parts;
}

function renderRow(ctx: Ctx, top: number, row: RowData, artUri: string | null, index: number, now: number): Section {
  const { theme, options, idPrefix, rightEdge, textX } = ctx;
  const midY = top + ROW_H / 2;
  const parts: string[] = [];

  // Art and text share a vertical centre: see TITLE_BASELINE_IN_ROW.
  const titleBaseline = top + TITLE_BASELINE_IN_ROW;
  const artistBaseline = titleBaseline + LINE_GAP;

  if (options.art) {
    const tile = artTile(artUri, PAD_X, top, ctx, index);
    const albumHref = safeSpotifyUrl(row.track.albumUrl);
    parts.push(
      albumHref
        ? link(
            albumHref,
            tile,
            `${idPrefix}-a`,
            row.track.album ? `${row.track.album} on Spotify` : 'Album on Spotify',
          )
        : tile,
    );
  }

  // The meta column is a single line, so it centres on the row rather than
  // sitting on the artist baseline beside a two-line block.
  const metaBaseline = centredBaseline(midY, META_SIZE);
  let metaWidth = 0;
  let metaSvg = '';

  if (row.live) {
    const label = 'Listening now';
    const labelWidth = estimateLayoutWidth(label, META_SIZE);
    metaWidth = EQ_WIDTH + EQ_TEXT_GAP + labelWidth;
    metaSvg =
      equaliser(rightEdge - metaWidth, metaBaseline, theme.accent, idPrefix) +
      text(label, rightEdge, metaBaseline, {
        size: META_SIZE,
        fill: theme.accent,
        anchor: 'end',
      });
  } else {
    const pieces = metaParts(options, row, now);
    if (pieces.length > 0) {
      const label = pieces.join(META_SEPARATOR);
      metaWidth = estimateLayoutWidth(label, META_SIZE);
      metaSvg = text(label, rightEdge, metaBaseline, {
        size: META_SIZE,
        fill: theme.meta,
        anchor: 'end',
      });
      // The visible label is relative; the exact moment goes in the tooltip,
      // where there is room to name a timezone.
      if (row.playedAt !== null) metaSvg = tooltip(absoluteTime(row.playedAt), metaSvg);
    }
  }

  const metaReserve = metaWidth > 0 ? metaWidth + 10 : 0;
  const showExplicit = options.explicit && row.track.explicit;
  const explicitReserve = showExplicit ? EXPLICIT_SIZE + EXPLICIT_GAP : 0;

  const titleMaxWidth = rightEdge - textX - metaReserve - explicitReserve;
  const title = truncateToWidth(row.track.name, TITLE_SIZE, titleMaxWidth, 600);
  const titleWidth = estimateWidth(title, TITLE_SIZE, 600);

  const artistLine = options.album && row.track.album
    ? `${row.track.artists.join(', ')}${META_SEPARATOR}${row.track.album}`
    : row.track.artists.join(', ');
  const artist = truncateToWidth(artistLine, ARTIST_SIZE, rightEdge - textX - metaReserve);
  const artistWidth = estimateWidth(artist, ARTIST_SIZE);

  // The title links where the SVG is interactive (direct view, <object>,
  // inline). GitHub embeds it through an <img>, which is inert - the link is
  // ignored there rather than breaking anything.
  const titleSvg = text(title, textX, titleBaseline, {
    size: TITLE_SIZE,
    weight: 600,
    fill: theme.title,
    className: `${idPrefix}-t`,
    textLength: showExplicit || title !== row.track.name ? titleWidth : undefined,
  });
  const href = safeSpotifyUrl(row.track.url);

  parts.push(
    // The tooltip carries what the row had to truncate away: the full title,
    // every artist, and the album.
    tooltip(trackTooltip(row.track), href ? link(href, titleSvg, `${idPrefix}-a`) : titleSvg),
    text(artist, textX, artistBaseline, {
      size: ARTIST_SIZE,
      fill: theme.artist,
      textLength: artist !== artistLine ? artistWidth : undefined,
    }),
    metaSvg,
  );

  if (showExplicit) {
    const x = textX + titleWidth + EXPLICIT_GAP;
    parts.push(
      explicitBadge(
        x,
        capCentre(titleBaseline, TITLE_SIZE) - EXPLICIT_SIZE / 2,
        EXPLICIT_SIZE,
        theme.meta,
      ),
    );
  }

  let height = ROW_H;

  // The progress bar belongs to the live row alone, and extends it rather than
  // being squeezed into the two lines above.
  if (row.live && ctx.progressFrom !== null) {
    const barY = top + height + PROGRESS_TOP_GAP;
    const barWidth = rightEdge - PAD_X;
    parts.push(
      `<rect x="${PAD_X}" y="${round(barY)}" width="${round(barWidth)}" height="${PROGRESS_H}" rx="${PROGRESS_H / 2}" fill="${theme.progressTrack}"/>`,
      `<rect class="${idPrefix}-pf" x="${PAD_X}" y="${round(barY)}" width="${round(barWidth)}" height="${PROGRESS_H}" rx="${PROGRESS_H / 2}" fill="${theme.accent}"/>`,
    );
    height += PROGRESS_TOP_GAP + PROGRESS_H;
  }

  return { svg: parts.join(''), height };
}

/**
 * The profile in the footer. Content follows `avatar`/`username` exactly as it
 * does in the header - only the placement differs.
 */
function renderFooterProfile(
  ctx: Ctx,
  top: number,
  avatarImage: string | null,
  align: 'left' | 'right',
): Section {
  const { theme, options, idPrefix } = ctx;
  const showAvatar = options.avatar;
  const showName = options.username !== 'off';
  if (!showAvatar && !showName) return EMPTY_SECTION;

  const height = showAvatar ? AVATAR_SIZE : (CAP_RATIO + DESC_RATIO) * USER_SIZE;
  const midY = top + height / 2;

  const nameWidth = showName ? estimateWidth(ctx.profileName, USER_SIZE, 600) : 0;
  const gap = showAvatar && showName ? AVATAR_GAP : 0;
  const avatarX =
    align === 'left' ? PAD_X : ctx.rightEdge - (showName ? nameWidth + gap : 0) - AVATAR_SIZE;
  const nameX =
    align === 'left' ? PAD_X + (showAvatar ? AVATAR_SIZE + gap : 0) : ctx.rightEdge;

  let body = '';
  if (showAvatar) body += avatarTile(avatarImage, avatarX + AVATAR_SIZE / 2, midY, ctx);
  if (showName) {
    body += text(
      ctx.profileName,
      nameX,
      centredBaseline(midY, USER_SIZE),
      {
        size: USER_SIZE,
        weight: 600,
        fill: theme.title,
        anchor: align === 'right' ? 'end' : undefined,
        className: `${idPrefix}-u`,
        textLength: align === 'right' && showAvatar ? nameWidth : undefined,
      },
    );
  }

  return {
    svg: link(
      ctx.profileHref,
      body,
      `${idPrefix}-a`,
      showName ? undefined : `${ctx.profileName} on Spotify`,
    ),
    height,
  };
}

function renderStyle(ctx: Ctx): string {
  const { idPrefix, theme } = ctx;

  // The progress bar animates by scaling a full-width rect, because CSS
  // cannot animate an SVG `width` attribute. `transform-box: fill-box` makes
  // the origin local to the rect rather than the whole document.
  //
  // The server can only send a snapshot, so a bar frozen at the position the
  // Worker saw would be wrong within seconds. Animating from that snapshot
  // toward the end of the track keeps it moving in real time in the reader's
  // browser. It runs once and holds, so a finished track shows a full bar
  // rather than restarting.
  const progress =
    ctx.progressFrom === null
      ? ''
      : `.${idPrefix}-pf{transform-box:fill-box;transform-origin:left center;transform:scaleX(${ctx.progressFrom.toFixed(4)})` +
        (ctx.progressRemainingMs > 0
          ? `;animation:${idPrefix}-prog ${Math.round(ctx.progressRemainingMs)}ms linear forwards}` +
            `@keyframes ${idPrefix}-prog{from{transform:scaleX(${ctx.progressFrom.toFixed(4)})}to{transform:scaleX(1)}}`
          : `}`);

  return (
    `<style>` +
    `.${idPrefix}-eq{transform-box:fill-box;transform-origin:bottom;animation:${idPrefix}-bounce 900ms ease-in-out infinite alternate}` +
    `@keyframes ${idPrefix}-bounce{from{transform:scaleY(0.22)}to{transform:scaleY(1)}}` +
    progress +
    // Hover resolves only where the SVG is interactive; in an <img> (i.e. on
    // GitHub) these rules are inert and the card renders in its base colors.
    `.${idPrefix}-a{cursor:pointer}` +
    `.${idPrefix}-t,.${idPrefix}-u{transition:fill 180ms ease-in-out}` +
    `.${idPrefix}-g{transition:opacity 180ms ease-in-out}` +
    `.${idPrefix}-a:hover .${idPrefix}-t,.${idPrefix}-a:hover .${idPrefix}-u{fill:${escapeCss(theme.titleHover)}}` +
    // The logo fades rather than recoloring: repainting a brand mark would
    // misrepresent it.
    `.${idPrefix}-a:hover .${idPrefix}-g{opacity:0.75}` +
    `@media (prefers-reduced-motion:reduce){.${idPrefix}-eq{animation:none}.${idPrefix}-pf{animation:none}` +
    `.${idPrefix}-t,.${idPrefix}-u,.${idPrefix}-g{transition:none}}` +
    `</style>`
  );
}

/* -------------------------------------------------------------------------- */
/* Card                                                                       */
/* -------------------------------------------------------------------------- */

export function renderCard({
  options,
  items,
  art,
  nowPlaying,
  nowPlayingArt,
  profile,
  avatarImage,
  now = Date.now(),
}: CardInput): string {
  const theme = resolveTheme(options.theme, {
    bg: options.bgColor,
    title: options.textColor,
    artist: options.artistColor,
    meta: options.metaColor,
    accent: options.accentColor,
  });
  const { width } = options;

  const live = options.nowPlaying ? (nowPlaying ?? null) : null;

  // Rendered as given. Choosing *which* tracks appear - deduping the live one
  // out of the history, applying `unique`, honouring `count` - belongs to the
  // caller, which has already done it before deciding what art to fetch.
  // Doing it again here duplicated the rule in opposite polarity, leaving two
  // places to keep in sync by hand.
  const rows: RowData[] = [
    ...(live ? [{ track: live.track, playedAt: null, live: true }] : []),
    ...items.map((item) => ({ track: item.track, playedAt: item.playedAt, live: false })),
  ];
  const rowArt: (string | null)[] = [...(live ? [nowPlayingArt ?? null] : []), ...art];

  const duration = live?.track.durationMs ?? 0;
  const elapsed = Math.min(Math.max(0, live?.progressMs ?? 0), duration);
  const showProgress = Boolean(live) && options.progress && duration > 0;

  const ctx: Ctx = {
    options,
    theme,
    // A stable, render-scoped id prefix keeps clipPath and animation ids from
    // colliding when two of these appear inline on one page. Two cards for
    // the same user with the same row count still collide - a known, accepted
    // gap, since inside an `<img>` on GitHub, the only context that matters
    // here, ids can't leak between documents at all.
    idPrefix: `sp${Math.abs(hashSeed(options.user + rows.length)).toString(36)}`,
    width,
    rightEdge: width - PAD_X,
    textX: PAD_X + (options.art ? ART_SIZE + ART_GAP : 0),
    profileHref: `https://open.spotify.com/user/${encodeURIComponent(options.user)}`,
    // `id` never needs the profile call and never uses its answer; `display`
    // falls back to the ID when the account has no display name, or when the
    // call was dropped because the token could not make it.
    profileName:
      options.username === 'id' ? options.user : profile?.displayName || options.user,
    progressFrom: showProgress ? elapsed / duration : null,
    // A paused track holds its position, so it gets the snapshot with no
    // animation rather than creeping toward the end while nothing is playing.
    progressRemainingMs: live?.isPlaying ? duration - elapsed : 0,
  };

  const body: string[] = [];
  let y = SECTION_PAD;

  if (options.header) {
    // Place the baseline so the content's highest ink lands on `y`. Both ends
    // are snapped to whole pixels: fractional positions would put the 1px
    // rules across a pixel boundary and render them soft.
    const extent = headerExtent(options);
    const baseline = Math.round(y - extent.top);
    body.push(renderHeader(ctx, baseline, avatarImage ?? null));
    y = Math.round(baseline + extent.bottom);

    // Rule closing the header block. The clearance either side of it is the
    // same SECTION_PAD used between rows, so the whole stack shares one rhythm.
    y += SECTION_PAD;
    if (rows.length > 0) body.push(rule(y, width, theme.divider));
    y += SECTION_PAD;
  }

  rows.forEach((row, i) => {
    const section = renderRow(ctx, y, row, rowArt[i] ?? null, i, now);
    body.push(section.svg);
    y += section.height;

    if (i < rows.length - 1) {
      y += SECTION_PAD;
      body.push(rule(y, width, theme.divider));
      y += SECTION_PAD;
    }
  });

  y += SECTION_PAD;

  // Footer: exactly one thing sits below the tracks. When `profile` puts the
  // picture and name down here, that *is* the footer and `footer` is ignored.
  const footerAlign = footerProfileAlign(options.profile);

  if (footerAlign) {
    const top = y + SECTION_PAD;
    const section = renderFooterProfile(ctx, top, avatarImage ?? null, footerAlign);
    // Only draw the rule if something ended up under it.
    if (section.height > 0) {
      body.push(rule(y, width, theme.divider), section.svg);
      y = Math.round(top + section.height) + SECTION_PAD;
    }
  } else if (options.footer === 'wave') {
    // The wave is its own visual break, so it gets no rule above it.
    body.push(waveDecor(PAD_X, y, width - PAD_X * 2, FOOTER_WAVE_H, theme.meta));
    y += FOOTER_WAVE_H + FOOTER_WAVE_PAD;
  }

  const height = round(y);
  const altText = buildAltText(rows);

  const bg = theme.bg;
  const background =
    bg === 'none'
      ? ''
      : `<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="${options.radius}" fill="${bg}" stroke="${theme.border}"/>`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(altText)}">` +
    // Browsers show <title> as the tab title, so it names the card rather than
    // describing it: a tab reading "Last played: ..." is unrecognisable once
    // the track changes. The description stays on aria-label, which is what
    // assistive tech reads for a role="img" element.
    `<title>${escapeXml(buildCardTitle(ctx.profileName))}</title>` +
    renderStyle(ctx) +
    background +
    body.join('') +
    `</svg>`
  );
}

/**
 * Spotify is named in both of these regardless of `logo`, so a card with the
 * mark switched off still attributes its content to Spotify for anything
 * reading the document rather than looking at it.
 */
function buildCardTitle(name: string): string {
  return `Spotify Recently Played - ${name}`;
}

function buildAltText(rows: RowData[]): string {
  if (rows.length === 0) return 'No recent Spotify tracks';
  const first = rows[0]!;
  const artists = first.track.artists.join(', ');
  const lead = first.live
    ? `Listening now on Spotify: ${first.track.name} by ${artists}`
    : `Last played on Spotify: ${first.track.name} by ${artists}`;
  return rows.length > 1 ? `${lead} (+${rows.length - 1} more)` : lead;
}

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}
