# spotify-recently-played

Cloudflare Worker rendering a Spotify "recently played" SVG card for GitHub profile READMEs, plus a static configurator. Replaces a Next.js/Vercel app; same Realtime Database and schema, so existing authorizations carry over.

## Commands

```bash
npm run dev          # wrangler dev on :8787
npm run typecheck
npm test
npm run deploy
```

Pushing to `main` runs typecheck + tests in GitHub Actions; Cloudflare Workers Builds deploys.

## Conventions

American spellings throughout - code, comments, docs and UI. The URL parameters are `bg_color`, `text_color` and so on, and prose that says "color" beside them reads as a different thing.

## What the rendering context forces

GitHub renders the card inside an `<img>`, proxied by Camo:

- **The SVG must be self-contained.** No external fonts, images, CSS or JS loads. Cover art is fetched server-side and inlined as a base64 data URI.
- **The card has a border, and it isn't optional.** Removed once, then put back: a borderless card floats ambiguously, and every theme already carries a `border` measured against its palette. A toggle would only add a parameter nobody needs.
- **Links, tooltips and `:hover` are inert inside an `<img>`**, so nothing may depend on them, but they work when opened directly. Track title, cover art and logo are links; title and timestamp carry `<title>` tooltips, which must be the **first child** of the element - why `tooltip()` wraps rather than appends.
- **The logo carries a transparent hit rect**, since a wordmark is mostly gaps between letters.
- **CSS animation does run** (progress bar); SMIL and external stylesheets aren't needed.
- **Errors return HTTP 200 with a valid SVG.** A 4xx renders as a broken-image icon and poisons Camo's cache.
- **Everything must finish inside Camo's ~10s socket timeout.** Firebase read, token refresh, one to three Spotify calls, then art - all share one `Deadline` (`src/util/deadline.ts`). Don't add independent timeouts, they sum.

## Spotify

### Read the OpenAPI schema, not the docs pages

`https://developer.spotify.com/reference/web-api/open-api-schema.yaml`. Several fields carry `deprecated: true`:

| Field | Would have been |
| --- | --- |
| `TrackObject.popularity`, `ArtistObject.popularity` | a popularity bar |
| `ArtistObject.genres` | genre tags |
| `ArtistObject.followers`, `PrivateUserObject.followers` | a stats strip like the Last.fm card's |
| `TrackObject.preview_url` | 30-second previews |

No `stats` option here: every number Spotify exposes about an account is deprecated.

### Things the schema does not tell you

- **`/me/player/currently-playing` returns 204 with an empty body** when nothing is playing. The schema documents 200/401/403/429 only, so `response.json()` throws on the most common case.
- **An insufficient scope answers 401, not 403.** Verified against a live token holding only `user-read-recently-played`: `/me/player/currently-playing` returns **401 "Permissions missing"** while `/me/player/recently-played` returns 200. The schema documents 403 for a bad OAuth request, and building around that broke every existing user's card. `optional()` in `src/index.ts` swallows 401 deliberately - that is not a bug.
- **`/me` works with any valid token.** `user-read-private` and `user-read-email` gate `country`, `email`, `product` and `explicit_content` (all deprecated). `id`, `display_name` and `images` always return.
- **`ContextObject` has no name** (only type/href/uri), so "played from Discover Weekly" costs an extra request per row.
- **`currently_playing_type` must be checked.** Episodes, ads and unknown items all reach that endpoint.

### Scopes and the migration

New authorizations request `user-read-recently-played` and `user-read-currently-playing`. Every account that authorized the Vercel app granted only the first, so **the now-playing row 401s for all of them until they reconnect** - the card drops that section and renders the rest. Never fail the card over an optional section.

`user-top-read` is deliberately not requested: the feature it would serve isn't built, and asking for a scope ahead of the feature is how consent screens get alarming.

### Terms

Spotify's Developer Terms require attribution, current data and no indefinite storage. So: the logo/title/aria-label always name Spotify regardless of `logo`; track data is cached 20-60s; nothing is aggregated or fed to a model.

Cover art is cached 24h. URLs are content-addressed (`i.scdn.co/image/<hash>`), so a new cover is a new URL - this caches an immutable asset, not stale metadata. The Vercel proxy sent `max-age=86400, immutable`.

## Tokens and Firebase

`firebase-admin` doesn't run on Workers, so `src/firebase.ts` signs a service-account JWT with WebCrypto and calls the Realtime Database REST API directly. Two npm alternatives exist; both last published 2023 - not worth adding to the credential path for one function.

- **Both Google scopes are required.** `firebase.database` alone fails - the read looks like a missing node rather than an auth error. `userinfo.email` must be there too.
- **The Google access token is cached per isolate**, never in the Cache API - signing an RS256 JWT and exchanging it on every render would dominate the budget. This also removed a cold start: the Admin SDK's first call could take seconds and blow Camo's timeout, which the `/api/warmup` cron endpoint existed to paper over.
- **Read the node in one request.** The Vercel app read `access_token` and `refresh_token` separately - two chances to spend the budget on data that arrives together.
- **`access_token` is written but never read.** The old `isValidToken()` did a `GET /v1/me` before every render to avoid a round trip; the stored copy is usually stale anyway, since it's only rewritten on refresh. The Worker just refreshes.

### The schema, and deleting the plaintext later

```
/{user}/refresh_token_enc   encrypted; preferred when present
/{user}/refresh_token       legacy plaintext; read fallback, still written
/{user}/access_token        legacy plaintext; still written, never read
/{user}/schema_v            1
```

The Vercel app is still live and hard-guards on both plaintext fields, so they are still written. A plaintext read is served and the encrypted copy written back behind `waitUntil`, so accounts migrate as their cards render; anyone whose card never renders stays on plaintext, which is where they are today anyway.

**When Vercel stops reading Firebase**, delete the two plaintext fields and drop the dual-write in `saveTokens`. Four-line diff, no migration script - but any node still lacking `refresh_token_enc` loses its token, so either leave the read fallback or encrypt the stragglers first.

### Token encryption

AES-256-GCM, key from `TOKEN_ENC_KEY`, stored as `v1:<base64url iv>:<base64url ciphertext+tag>` with the Spotify user ID as `additionalData` so a value copied to another node fails to decrypt. `decryptToken` returns null rather than throwing, so a key or format problem falls back to the plaintext field instead of locking someone out. The `v1:` prefix is kept because it is free; nothing is built behind it.

## Configuration

Only four are credentials.

| Name | Kind | Where |
| --- | --- | --- |
| `SPOTIFY_CLIENT_SECRET` | secret | `wrangler secret put` |
| `FIREBASE_PRIVATE_KEY_B64` | secret | `wrangler secret put` |
| `STATE_SECRET` | secret | `wrangler secret put` |
| `TOKEN_ENC_KEY` | secret | `wrangler secret put` |
| `SPOTIFY_CLIENT_ID` | public | `wrangler.jsonc` |
| `PUBLIC_BASE_URL` | public | `wrangler.jsonc` |
| `UPSTREAM_CACHE_SECONDS`, `NOW_PLAYING_CACHE_SECONDS`, `ART_CACHE_SECONDS` | public | `wrangler.jsonc` |
| `FIREBASE_PROJECT_ID` | unpublished, not sensitive | dashboard |
| `FIREBASE_CLIENT_EMAIL` | unpublished, not sensitive | dashboard |
| `FIREBASE_DATABASE_URL` | unpublished, not sensitive | dashboard |

**The client ID is public by design.** It appears in the authorize URL every user's browser follows, and the Vercel app called it `NEXT_PUBLIC_CLIENT_ID`.

**The three Firebase identifiers are not credentials.** The client email is useless without the private key; `database.rules.json` locks the database to `.read: false` / `.write: false`, so security comes from rules and the service account, not URL obscurity. They stay out of the repo only because it's public, and publishing the URL would advertise a probing target for no benefit.

Why the split matters:

- **A secret cannot be read back.** A typo'd `FIREBASE_DATABASE_URL` stored as a secret is undebuggable by inspection - you can only overwrite and retry.
- **Secrets cannot live in `wrangler.jsonc`**, so over-classifying stops the config being self-documenting and forces every new environment to re-enter values by hand.
- **It dilutes the signal.** If everything is a secret, nothing marks out `TOKEN_ENC_KEY` as the one that must be backed up. Losing it after plaintext deletion means every user re-authorizes.

**`wrangler deploy` replaces the entire `vars` set** with whatever is in `wrangler.jsonc`, deleting anything it does not declare. The three dashboard values are only safe because `wrangler.jsonc` sets `keep_vars: true`; without it every deploy silently wipes them and the card starts rendering the missing-configuration error.

## Option model

`profile` (`header` / `footer-left` / `footer-right` / `off`) says **where** your identity goes; `username` and `avatar` say **what's in it**. Folding placement into content once made the `avatar` toggle look header-only on the Last.fm card. The footer holds exactly **one** thing - when `profile` is in the footer, `footer` is ignored.

`username` is `display` / `id` / `off`. A display name and a user ID are different things - many accounts share nothing between them. `id` needs no `/v1/me` call since it's already in the URL. The old boolean form still parses (`1` = `display`).

`now_playing` is a plain boolean: pins the live track on top of history. It was briefly `auto` / `off` / `only`, where `only` dropped history and retitled the card "Now Playing" - removed as a second card wearing the same parameter. `bool` still reads the old `off` spelling and treats retired `auto` as the default, so existing URLs keep working.

## Configurator

`public/` is plain HTML, CSS and JS with no build step; the page's job is to assemble a URL string.

- **Only values that differ from the theme reach the URL.** Color fields show what the card uses (copyable), and a field equal to its theme value is treated as unset. Resetting writes the theme's value back.
- **Which fields count as the user's is tracked, not inferred.** A comparison against the theme cannot tell untouched from deliberately-same, and every field would turn custom the moment the theme changed.
- **Color swatches are bound to `change`, not `input`.** A native picker fires continuously while dragging and every preview is a Worker request. `input` is listened to only to mark the picker in use - **do not guard that with `document.activeElement`**: a color input can keep focus after its picker closes, so the swatch stops following the field. That made Reset look like it updated the text but not the color until clicked twice.
- **Reset is disabled while a field matches the theme** - resetting something already at its default would look like it did nothing.
- `THEME_COLORS` mirrors each theme's settable colors from `render/themes.ts`. Update both together, or an untouched picker shows a color the card isn't using.
- **There is no sample username.** The Last.fm configurator opens on a real card because any public account works; here the card only renders for connected accounts, so a placeholder would draw an error card. The name comes from `?user=` (what the callback page links with).

## Gotchas

- **Every string from Spotify goes through `escapeXml`.** One bare `&` breaks the entire image, silently, with nothing in any log. This is the most common way to ship a broken card.
- **Caller-supplied colors are validated, not escaped.** Every color parameter is interpolated into an SVG attribute, so `parseHexColor` allowlists a strict hex shape and returns null otherwise. Any new color parameter must go through it - this is a security boundary, not a formatting preference, and the only one: `escapeCss` exists solely for the `<style>` block, where a stray `</style>` would break out.
- **The art `Content-Type` is allowlisted, not prefix-matched.** It ends up inside an SVG attribute and `"` is legal in an HTTP field value, so `startsWith('image/')` was not enough. The exact list also keeps out `image/svg+xml`, which would be parsed rather than decoded once inlined.
- **`isValidUserId` is a security boundary.** With the Admin SDK the user ID was a key; over REST it's a path segment in `/{user}.json`, so `/`, `..` and anything that ends the path early matter. Validate first, then `encodeURIComponent` - encoding alone is not the boundary. The rule is an allowlist rather than the "not `. $ # [ ] /`" that Realtime Database keys imply, because a path segment also cares about `%`, `?`, whitespace and control characters. Nobody outside the allowlist can already be stored, since the old Admin SDK would have thrown on the way in.
- **Case is never normalized.** Realtime Database keys are case-sensitive, the old app stored whatever `/v1/me` returned, and lookups use the raw `?user=` value, so lowercasing anywhere - a cache key included - would fail to find existing nodes.
- **`isAllowedArtUrl` is a security boundary.** Without it the endpoint is an open proxy. Host matching is written to fail closed: parsed `hostname` rather than a substring test on the URL (which would accept `https://evil.test/?x=i.scdn.co`), `host === d || host.endsWith('.' + d)` rather than a bare suffix check (which would accept `evil-spotifycdn.com`), https only, and no userinfo.
- **Workers only implement `redirect: 'follow'` and `'manual'`.** `'error'` throws a `TypeError` on the edge, and local `wrangler dev` does *not* reproduce it. Verify subrequest behaviour against a real deploy or `wrangler dev --remote`, not just local.
- **Most of `Theme` is derived, not chosen.** `bg`, `title`, `artist`, `meta` and `accent` are the only settable palette colors; borders, dividers, placeholders and progress track are mixes of text and background (`render/color.ts`). They are named as **roles, not elements** - `meta` is the timestamps, the durations and the footer together. `resolveTheme` returns the preset object itself when nothing is overridden, and a test asserts that by identity, so existing cards cannot drift.
- **`logo_color` is not part of `Theme`.** The Spotify logo is a trademark, so it defaults to brand green in every palette and lives as an option rather than a theme field.
- **`light`'s accent is not brand green.** `#1db954` on white is 2.3:1, which is unreadable for the "Listening now" label. That theme uses the same green darkened to 5.4:1; the logo above it stays brand green, because the trademark argument applies to the mark and not to an equaliser bar.
- **`artist` and `meta` are two controls on purpose.** nord and catppuccin pair a hued artist line with a neutral grey timestamp, and deriving one from the other turns that grey blue or purple.
- **A background can make a theme unreadable.** `?bg_color=ffffff` on `dark` would paint near-white text onto white. `resolveTheme` borrows the inks from whichever built-in palette suits the background when contrast fails.
- **The Cache API is a no-op on `*.workers.dev`.** It is zone-level, and workers.dev is not a zone, so `caches.default` silently does nothing there; the per-isolate memo in `cache.ts` is what actually collapses requests until a custom domain is attached. Note this is the *legacy* Cache API
  - Workers Cache (`[cache] enabled` in wrangler config) is zoneless and does run on workers.dev, but it only helps responses that are cacheable, which is why the card sends `max-age` rather than `no-cache`. Sources: [Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/) ("Workers deployed to custom domains have access to functional `cache` operations"), [How the Cache works](https://developers.cloudflare.com/workers/reference/how-the-cache-works/).
- **Bearer tokens use `memoOnly*`, never the two-layer cache.** The Cache API persists at the edge and, in dev, to `.wrangler/state`, which is the wrong lifetime for a credential.
- **miniflare persists the cache across dev restarts** in `.wrangler/state/v3/cache`. Delete it when testing cache behaviour, or you'll spend an hour debugging a stale negative entry.
- **`.dev.vars` holds real credentials.** Gitignored - never print or commit it.

## Layout code

`src/render/card.ts` derives positions from measured font metrics (`CAP_RATIO`, `DESC_RATIO`) rather than tuned numbers, because tuned numbers drift apart the moment a font size changes.

**`renderCard` draws exactly the rows it is handed.** Choosing which tracks appear - deduping the live one out of the history, applying `unique`, honouring `count` - belongs to `handleCard`, which has to do it anyway before deciding what art to fetch. It was briefly done in both places, in opposite polarity, and that is the main reason the art index alignment was hard to audit.

- `SECTION_PAD` is the **only** general vertical spacing constant. Adding a second one is how the spacing became inconsistent before.
- Section renderers return `{ svg, height }`. Height belongs next to the markup that produces it - a separate `*_H` constant is a second source of truth and will silently disagree. The now-playing row is why this matters here: it is taller than the others when the progress bar or context line is on.
- `ART_SIZE` is derived from the type sizes so artwork stays aligned with the text beside it.
- Snap block boundaries to whole pixels; fractional `y` makes the 1px rules render soft.
- Text is centred on its cap-to-baseline extent, not its ink - descenders read as overhang.
- **The logo sits on the title's baseline, and its size is derived.** Both numbers come from measuring the path, not the viewBox - the circle fills the box, but the "Spotify" glyphs occupy a band inside it: ink `0.28..167.76`, wordmark `38.79..140.34`, baseline at **122.89** (the flat-bottomed "i" stem; round letters overshoot to 124.18 as optical correction), cap top at 45.03. So the cap height is **0.4634** of the box, and `LOGO_H = logoHeightForCap(...)` sizes it so "Spotify" matches "Recently Played" exactly. Centring the logo on its box instead - the first version's assumption that a circle-dominated mark can't be baselined - put the wordmark visibly off, and the guessed cap ratio in that comment (~0.37) was wrong.
- **The avatar centres on the text it sits beside**, which is the name at `USER_SIZE`, not the title at `HEADER_TITLE_SIZE`. Centring on the title left the pair about a pixel out of step.
- **The header is centred on the title's cap-to-baseline middle, not on the union of its ink.** Those differ, and visibly: the avatar hangs ~9px below the baseline while nothing reaches as far above it, so balancing the union dragged the band down and left the title ~1.1px high - but only when a picture was shown, so it read as a jump when the option was toggled rather than as a constant offset. This is the same rule the rows already use, where a descender is overhang rather than part of the line.
- **The progress bar scales a rect**, since CSS can't animate an SVG `width` attribute. It animates from the snapshot the Worker saw toward the end of the track and holds there, so a finished track shows a full bar rather than restarting; a paused track gets the snapshot with no animation.
- `icons.ts` is fixed artwork; `decor.ts` is generated graphics sized to the space it's given. `measure.ts` holds advance widths for the stack in `font.ts`, so those two move together.

## Logging

`src/log.ts` is the only place `console.*` is called. Workers Logs indexes the **fields of an object**, so every call passes one object and never a formatted string - `console.log('art failed', url)` is greppable text, `logWarn('art', msg, { failed: 2 })` is a column. Event and field names are shared with the Last.fm Worker, so one query covers both.

Every call also passes a **`message`**, and it is a required parameter rather than an optional field. The fields are what you query; `message` is what the dashboard renders in its default column, and that column is blank for a log that carries only fields. Keep it a readable one-liner - `oauth: connected user123` - since the fields already carry the same values in queryable form.

Nothing is logged that the platform already has. The invocation log carries the method, URL, query, status, colo, country, user agent and wall/CPU time; `observability.traces` times every subrequest, which is why there are no hand-rolled timings around Firebase or Spotify. What neither can see is whether the card *worked*, because an error card is a valid SVG at HTTP 200 - from the outside every failure looks like a success. That is what the `card` event is for, and why it fires on success too.

- **`card`** - one line per request, always, with the exception folded in rather than emitted as a second row. `outcome`, `reason`, `client`, `user`, `path`, `ms`, `tracks`, `live`, `degraded`.
- **`card.section`** - an optional section failed for a reason that is *not* the documented legacy 401. That 401 fires on every request for every pre-Worker account, so it would be the highest-volume log here and say nothing; it is counted in `degraded` on the card event instead.
- **`art`** - only when a cover is missing, aggregated into one line per request rather than one per cover (unlike the Last.fm Worker, everything here shares a single `inlineArt` call). `blocked_hosts` catches the `isAllowedArtUrl` gotcha, which is otherwise entirely silent.
- **`auth`** - `refreshed` (memo miss, so it counts the cold path rather than every render), `encrypted`, `decrypt_failed`, `encrypt_failed`, `writeback_failed`. `rotated` on the refresh is the one to watch: a write-back that fails after a rotation can leave the stored token dead. Counting `encrypted` is what tells you whether the plaintext fields can be dropped yet.
- **`firebase`** - a non-404 REST failure, with `op` and the truncated body. `error_description` is the difference between clock skew and a wrong key.
- **`oauth`** - the whole flow: `start`, `connected`, `disconnected`, `denied`, `state_invalid`, `failed`. It runs once per user rather than once per view, so it is cheap, and `start` against `connected` is the only way to see people falling out of it. `state_invalid` is also what a forged callback looks like.

`client` collapses the user agent to `vercel` / `camo` / `browser` / `other`, so "how much traffic still comes through the old Vercel deployment" is a group-by rather than four text matches. Vercel is checked first and beats Camo: a README embedding the Vercel URL goes reader → Camo → Vercel → here, and the question is which deployment the markdown points at. `path` answers the same kind of question for the legacy `/api` alias.

`level` is the alerting surface: `error` means the *service* is broken (`not_configured`, `storage`, `auth`, `unhandled`), `warn` means this one request could not be served. `upstream` and `rate_limited` stay at `warn` deliberately - a Spotify outage is real, but no deploy fixes it and it would drown the genuine faults.

Never log a token, a refresh token or the `Authorization` header. Firebase bodies are truncated to 300 chars by `safeText` and are Google error descriptions, not credentials.

## Testing

Deliberately minimal and it should stay that way. It covers what fails *silently*: well-formed and escaped SVG, untrusted input (track URLs, art hosts, user IDs), the upstream response shapes, the HTTP contract, and the color maths - a wrong mix ratio or a dropped contrast check produces a card that renders perfectly and just looks wrong.

**Don't add pixel-position assertions.** They were tried on the Last.fm card; every layout change broke them and the test was wrong every time. They were tried again here too, as three header-alignment tests re-deriving the layout from metrics copied out of `icons.ts` - a second implementation of the arithmetic asserting the first agreed with it. They caught one real bug, then were deleted: the standing cost is that any layout change breaks them and the failure says nothing useful. Verify visual work by rendering against `npm run dev` and looking at it.

**Keep the suite small.** It is deliberately about half the size it once was. Before adding a test, check it would fail for a reason that is invisible in the rendered card — escaping, an allowlist, a response shape, the HTTP contract, the crypto binding, a contrast floor. Anything that only restates what the code says will have to be edited in lockstep with it.

**Every worker test must fail before any upstream call.** `vitest-pool-workers` loads `.dev.vars`, so a machine set up for local development runs the suite fully configured. A happy-path test would quietly hit live Spotify and Firebase with real credentials, passing or failing depending on whose laptop it ran on - which happened once, briefly, before it was noticed.

Static assets aren't served through `SELF.fetch` in vitest-pool-workers - the runtime handles them before the Worker - so the configurator is only verifiable against a real dev server.

## Simple over robust

This is a hobby project: it can tolerate faults, downtime and a broken card for a while, and fix-forward is fine. Where a simple approach and a more operationally robust one were weighed, the simple one won:

- **No retry ladder on 429.** Read `Retry-After`, render a friendly card, put the wait into the response's own `max-age` and let the edge absorb it. Retrying inside a ~10s budget isn't worth it.
- **No feature flag on the plaintext dual-write.** Deleting it later is a four-line diff.
- **No backfill script.** Lazy migration on read; accounts that never render stay on plaintext.
- **No crypto spec document or test vectors.** One round-trip test and one cross-user test. There is no second implementation to be interoperable with.
- **No key-rotation machinery.** The `v1:` prefix is kept because it costs nothing.
- **No warmup endpoint.** Removed along with the Admin SDK cold start it existed to paper over.

If you catch yourself designing a flag, a phase, a migration script or a runbook here, that is a signal to stop and pick the boring option.
