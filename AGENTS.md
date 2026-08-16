# spotify-recently-played

Cloudflare Worker that renders a Spotify "recently played" card as an SVG for GitHub profile READMEs, plus a static configurator that builds the embed snippet. Replaces a Next.js app on Vercel; the Realtime Database behind it is the same one, with the same schema, so nobody who authorized the old app has to authorize again.

## Commands

```bash
npm run dev          # wrangler dev on :8787
npm run typecheck
npm test
npm run deploy
```

Pushing to `master` runs typecheck + tests in GitHub Actions; Cloudflare Workers Builds deploys.

## Conventions

American spellings throughout - code, comments, docs and UI. The URL parameters are `bg_color`, `text_color` and so on, and prose that says "color" beside them reads as a different thing.

## What the rendering context forces

GitHub renders the card inside an `<img>`, proxied by Camo. Almost every design decision follows from that:

- **The SVG must be self-contained.** No external fonts, images, CSS or JS - none of it loads. Cover art is fetched server-side and inlined as a base64 data URI.
- **The card has a border, and it is not optional.** It was briefly removed, then put back: at a glance a borderless card floats ambiguously against a README's background, and the themes already carry a `border` measured against each palette. Making it a toggle just adds a parameter nobody needs to think about.
- **Links, tooltips and `:hover` are inert inside an `<img>`**, which is how GitHub embeds the card, so nothing may depend on them - but they all work when the SVG is opened directly or inlined, and they cost a few bytes. The track title, the cover art and the logo are links; the title and the timestamp carry `<title>` tooltips. A `<title>` must be the **first child** of the element it describes, which is why `tooltip()` wraps rather than appends.
- **The logo carries a transparent hit rect.** Without it only the ink is clickable, and a wordmark is mostly not ink - the gaps between letters would fall through.
- **CSS animation does run**, which is why the progress bar can move. SMIL and external stylesheets are not needed and would not help.
- **Errors return HTTP 200 with a valid SVG.** A 4xx renders as a broken-image icon with no explanation and poisons Camo's cache with the failure.
- **Everything must finish inside Camo's ~10s socket timeout.** This card has more upstream steps than the Last.fm one - a Firebase read, a token refresh, one to three Spotify calls, then art - so they all share one `Deadline` (`src/util/deadline.ts`). Don't add independent timeouts, they sum.

## Spotify

### Read the OpenAPI schema, not the docs pages

`https://developer.spotify.com/reference/web-api/open-api-schema.yaml`. Several fields that look perfect for this card carry `deprecated: true` and are therefore off the table:

| Field | Would have been |
| --- | --- |
| `TrackObject.popularity`, `ArtistObject.popularity` | a popularity bar |
| `ArtistObject.genres` | genre tags |
| `ArtistObject.followers`, `PrivateUserObject.followers` | a stats strip like the Last.fm card's |
| `TrackObject.preview_url` | 30-second previews |

That is also why there is no `stats` option here: every number Spotify exposes about an account is deprecated, so there is nothing honest to count.

### Things the schema does not tell you

- **`/me/player/currently-playing` returns 204 with an empty body** when nothing is playing. The schema documents 200/401/403/429 only, so `response.json()` throws on the most common case.
- **An insufficient scope answers 401, not 403.** Verified against a live token holding only `user-read-recently-played`: `/me/player/currently-playing` returns **401 "Permissions missing"** while `/me/player/recently-played` returns 200. The schema documents 403 for a bad OAuth request and this was built around that, which made every existing user's card fail. See `optional()` in `src/index.ts` - it swallows 401 deliberately, and that is not a bug.
- **`/me` works with any valid token.** The schema lists `user-read-private` and `user-read-email` as its scopes, but those gate `country`, `email`, `product` and `explicit_content` - all deprecated, none of them read here. `id`, `display_name` and `images` always come back, which is how the Vercel app read it for years with one scope.
- **`ContextObject` has no name**, only a type, an href and a URI, so "played from Discover Weekly" would cost an extra request per row. That is why the card does not offer it.
- **`currently_playing_type` must be checked.** Episodes, ads and unknown items all reach that endpoint.

### Scopes and the migration

New authorizations request `user-read-recently-played` and `user-read-currently-playing`, and nothing else. Every account that authorized the Vercel app granted the first alone, so **the now-playing row 401s for all of them until they reconnect** - the card drops that section and renders the rest. Never fail the card over an optional section.

`user-top-read` is deliberately not requested. The feature it would serve is not built, and asking for a scope ahead of the feature is how consent screens become alarming.

### Terms

Spotify's Developer Terms require that content is attributed, that displayed data is reasonably current, and that Spotify Content is not stored indefinitely. So: the logo is on by default and Spotify is named in the SVG `<title>` and `aria-label` regardless of `logo`; track data is cached for 20-60s; and nothing is aggregated, compiled or fed to a model.

Cover art is cached for 24h, which is the one number worth defending. Spotify's image URLs are content-addressed (`i.scdn.co/image/<hash>`), so a new cover is a new URL and the cached entry simply stops being referenced - it is caching a rendition of an immutable asset, not metadata past its freshness. The Vercel proxy already sent `max-age=86400, immutable`.

## Tokens and Firebase

`firebase-admin` is a Node SDK and does not run on Workers. `src/firebase.ts` signs a service-account JWT with WebCrypto and calls the Realtime Database REST API directly. Two npm packages would have done this; both were last published in 2023, and neither is worth having in the credential path for one function.

- **Both Google scopes are required.** `firebase.database` alone is not enough - the read fails and the failure looks like a missing node rather than an auth problem. `userinfo.email` must be there too.
- **The Google access token is cached per isolate**, never in the Cache API. Signing an RS256 JWT and exchanging it on every render would dominate the budget. This is also what removed the cold start the old README documented at length: the Admin SDK's first call could take seconds and blow Camo's timeout, which is what the `/api/warmup` cron endpoint existed to paper over.
- **Read the node in one request.** The Vercel app read `access_token` and `refresh_token` separately, which is two chances to spend the budget on data that arrives together.
- **`access_token` is written but never read.** The old `isValidToken()` spent a `GET /v1/me` before every render to avoid a round trip, and the stored copy is only rewritten on refresh so it is usually stale anyway. The Worker just refreshes.

### The schema, and deleting the plaintext later

```
/{user}/refresh_token_enc   encrypted; preferred when present
/{user}/refresh_token       legacy plaintext; read fallback, still written
/{user}/access_token        legacy plaintext; still written, never read
/{user}/schema_v            1
```

The Vercel app is still live against this database and hard-guards on both plaintext fields, so they are still written. A plaintext read is served and the encrypted copy written back behind `waitUntil`, so accounts migrate as their cards render; anyone whose card never renders stays on plaintext, which is where they are today anyway.

**When Vercel stops reading Firebase**, delete the two plaintext fields and drop the dual-write in `saveTokens`. That is a four-line diff and needs no migration script - but note that any node still lacking `refresh_token_enc` at that point loses its token, so either leave the read fallback in place or encrypt the stragglers first.

### Token encryption

AES-256-GCM, key from `TOKEN_ENC_KEY`, stored as `v1:<base64url iv>:<base64url ciphertext+tag>` with the Spotify user ID as `additionalData` so a value copied to another node fails to decrypt. `decryptToken` returns null rather than throwing, so a key or format problem falls back to the plaintext field instead of locking someone out. The `v1:` prefix is kept because it is free; nothing is built behind it.

## Configuration

Only four of these are credentials. The distinction is not cosmetic - see below.

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

**The client ID is public by design.** It appears in the authorize URL every user's browser follows, and the Vercel app called it `NEXT_PUBLIC_CLIENT_ID` and shipped it to the client.

**The three Firebase identifiers are not credentials.** The client email is useless without the private key, and the database URL is explicitly not a secret - `database.rules.json` locks the database to `.read: false` / `.write: false`, so security comes from the rules plus the service account and never from the URL being unguessable. They stay out of the repo only because the repo is public, and publishing the database URL advertises a probing target for no benefit. Do not treat them with ceremony they do not need, and do not assume the URL being hidden is load-bearing.

Why the split matters, given all three could technically be secrets:

- **A secret cannot be read back.** A typo'd `FIREBASE_DATABASE_URL` stored as a secret is undebuggable by inspection; you can only overwrite and retry.
- **Secrets cannot live in `wrangler.jsonc`**, so over-classifying makes the config stop being self-documenting and every new environment needs values re-entered by hand.
- **It dilutes the signal.** If everything is a secret, nothing marks out `TOKEN_ENC_KEY` as the one that must be backed up. Once the plaintext fields are deleted, losing it means every user re-authorizes.

**`wrangler deploy` replaces the entire `vars` set** with whatever is in `wrangler.jsonc`, deleting anything it does not declare. The three dashboard values are only safe because `wrangler.jsonc` sets `keep_vars: true`; without it every deploy silently wipes them and the card starts rendering the missing-configuration error.

## Option model

`profile` (`header` / `footer-left` / `footer-right` / `off`) says **where** your identity goes; `username` and `avatar` say **what's in it**. Folding placement into content is what once made the `avatar` toggle look header-only on the Last.fm card. The footer holds exactly **one** thing - when `profile` is in the footer, `footer` is ignored rather than stacked underneath.

`username` is `display` / `id` / `off` rather than a boolean, because a display name and a user ID are genuinely different things - plenty of accounts have a display name sharing nothing with the ID people would search for. It is not only cosmetic either: `id` is already in the URL, so it needs no `/v1/me` call. The old boolean form still parses, with `1` meaning `display`.

`now_playing` is a plain boolean: it pins the live track on top of the history while you are listening. It was briefly `auto` / `off` / `only`, where `only` dropped the history entirely and retitled the card "Now Playing", but that was a second card wearing the same parameter and it was removed. `bool` still reads the old `off` spelling, and treats the retired `auto` as the default it always was, so existing URLs keep working.

## Configurator

`public/` is plain HTML, CSS and JS with no build step, and the page's whole job is to assemble a URL string.

- **Only values that differ from the theme reach the URL.** The color fields are filled in with whatever the card is using, so they can be copied out, and a field equal to its theme value is treated as unset. Resetting writes the theme's value back.
- **Which fields count as the user's is tracked, not inferred.** A comparison against the theme cannot tell an untouched field from one deliberately set to the same color, and every field would turn custom the moment the theme changed under it.
- **Color swatches are bound to `change`, not `input`.** A native picker fires continuously while dragging and every preview is a request to the Worker. `input` is still listened to, but only to mark the picker in use - **do not guard that with `document.activeElement`**, which asks a different question: a color input can keep focus after its picker has closed, and the swatch then stops following the field entirely. That is what made Reset look like it updated the text and not the color until clicked twice.
- **Reset is disabled while a field matches the theme.** Resetting something already at its default looks like it did nothing.
- `THEME_COLORS` mirrors each theme's settable colors from `render/themes.ts`. Update both together, or an untouched picker shows a color the card isn't using.
- **There is no sample username.** The Last.fm configurator opens on a real card because any public account works; here the card only renders for accounts that have connected, so a placeholder would draw an error card and look broken. The name comes from `?user=`, which is what the callback page links with.

## Gotchas

- **Every string from Spotify goes through `escapeXml`.** One bare `&` breaks the entire image, silently, with nothing in any log. This is the most common way to ship a broken card.
- **Caller-supplied colors are validated, not escaped.** Every color parameter is interpolated into an SVG attribute, so `parseHexColor` allowlists a strict hex shape and returns null otherwise. Any new color parameter must go through it - this is a security boundary, not a formatting preference, and it is *the* boundary: `escapeCss` exists only for the `<style>` block, where a stray `</style>` would break out. It was once sprinkled across attributes too, which implied a guarantee nothing enforced.
- **The art `Content-Type` is allowlisted, not prefix-matched.** It ends up inside an SVG attribute and `"` is legal in an HTTP field value, so `startsWith('image/')` was not enough. The exact list also keeps out `image/svg+xml`, which would be parsed rather than decoded once inlined.
- **`isValidUserId` is a security boundary.** With the Admin SDK the user ID was a key; over REST it is a path segment in `/{user}.json`, so `/`, `..` and anything that ends the path early matter. Validate first, then `encodeURIComponent` - encoding alone is not the boundary. The rule is an allowlist rather than the "not `. $ # [ ] /`" that Realtime Database keys imply, because a path segment also cares about `%`, `?`, whitespace and control characters. Nobody outside the allowlist can already be stored, since the old Admin SDK would have thrown on the way in.
- **Case is never normalized.** Realtime Database keys are case-sensitive, the old app stored whatever `/v1/me` returned, and lookups use the raw `?user=` value, so lowercasing anywhere - a cache key included - would fail to find existing nodes.
- **`isAllowedArtUrl` is a security boundary.** Without it the endpoint is an open proxy. Host matching is written to fail closed: parsed `hostname` rather than a substring test on the URL (which would accept `https://evil.test/?x=i.scdn.co`), `host === d || host.endsWith('.' + d)` rather than a bare suffix check (which would accept `evil-spotifycdn.com`), https only, and no userinfo.
- **Workers only implement `redirect: 'follow'` and `'manual'`.** `'error'` throws a `TypeError` on the edge, and local `wrangler dev` does *not* reproduce it. Verify subrequest behaviour against a real deploy or `wrangler dev --remote`, not just local.
- **Most of `Theme` is derived, not chosen.** `bg`, `title`, `artist`, `meta` and `accent` are the only settable palette colors; the borders, dividers, placeholders and progress track are mixes between the text color and the background (`render/color.ts`). They are named as **roles, not elements** - `meta` is the timestamps, the durations and the footer together. `resolveTheme` returns the preset object itself when nothing is overridden, and a test asserts that by identity, so existing cards cannot drift.
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

- `SECTION_PAD` is the **only** general vertical spacing constant. Adding a second one is exactly how the spacing became inconsistent before.
- Section renderers return `{ svg, height }`. Height belongs next to the markup that produces it - a separate `*_H` constant is a second source of truth and will silently disagree. The now-playing row is why this matters here: it is taller than the others when the progress bar or context line is on.
- `ART_SIZE` is derived from the type sizes so artwork stays aligned with the text beside it.
- Snap block boundaries to whole pixels; fractional `y` makes the 1px rules render soft.
- Text is centred on its cap-to-baseline extent, not its ink - descenders read as overhang.
- **The logo sits on the title's baseline, and its size is derived.** Both numbers come from measuring the path, not from the viewBox - the circle fills the box, but the "Spotify" glyphs occupy a band inside it: ink `0.28..167.76`, wordmark `38.79..140.34`, baseline at **122.89** (the flat-bottomed "i" stem; the round letters overshoot to 124.18 as optical correction), cap top at 45.03. So the cap height is **0.4634** of the box, and `LOGO_H = logoHeightForCap(...)` sizes it so "Spotify" matches "Recently Played" exactly. Centring the logo on its box instead - which is what the first version did, on the assumption that a circle-dominated mark could not be baselined - put the wordmark visibly off, and the guessed cap ratio in that comment (~0.37) was simply wrong.
- **The avatar centres on the text it sits beside**, which is the name at `USER_SIZE`, not the title at `HEADER_TITLE_SIZE`. Centring on the title left the pair about a pixel out of step.
- **The header is centred on the title's cap-to-baseline middle, not on the union of its ink.** Those differ, and visibly: the avatar hangs ~9px below the baseline while nothing reaches as far above it, so balancing the union dragged the band down and left the title ~1.1px high - but only with a picture shown, so it read as a jump when the option was toggled rather than as a constant offset. This is the same rule the rows already use, where a descender is overhang rather than part of the line.
- **The progress bar scales a rect**, because CSS cannot animate an SVG `width` attribute. It animates from the snapshot the Worker saw toward the end of the track and holds there, so a finished track shows a full bar rather than restarting. A paused track gets the snapshot and no animation.
- `icons.ts` is fixed artwork; `decor.ts` is generated graphics sized to the space it's given. `measure.ts` holds advance widths for the stack in `font.ts`, so those two move together.

## Testing

Deliberately minimal and it should stay that way. It covers what fails *silently*: well-formed and escaped SVG, untrusted input (track URLs, art hosts, user IDs), the upstream response shapes, the HTTP contract, and the color maths - a wrong mix ratio or a dropped contrast check produces a card that renders perfectly and just looks wrong.

**Don't add pixel-position assertions.** They were tried on the Last.fm card; every layout change broke them and the test was wrong every time. They were tried again here, as three header-alignment tests that re-derived the layout from metrics copied out of `icons.ts` — a second implementation of the arithmetic asserting the first agreed with it. They caught one real bug and were then deleted, because the standing cost is that any layout change breaks them and the failure says nothing useful. Verify visual work by rendering against `npm run dev` and looking at it.

**Keep the suite small.** It is deliberately about half the size it once was. Before adding a test, check it would fail for a reason that is invisible in the rendered card — escaping, an allowlist, a response shape, the HTTP contract, the crypto binding, a contrast floor. Anything that only restates what the code says will simply have to be edited in lockstep with it.

**Every worker test must fail before any upstream call.** `vitest-pool-workers` loads `.dev.vars`, so on a machine set up for local development the Worker is fully configured while the suite runs. A happy-path test would quietly make live Spotify and Firebase calls with real credentials and pass or fail depending on whose laptop it ran on. One did, briefly, before this was noticed.

Static assets aren't served through `SELF.fetch` in vitest-pool-workers - the runtime handles them before the Worker - so the configurator is only verifiable against a real dev server.

## Simple over robust

This is a hobby project. It can tolerate faults, downtime and a broken card for a while, and fix-forward is fine. Where a simple approach and a more operationally robust one were weighed, the simple one won:

- **No retry ladder on 429.** Read `Retry-After`, render a friendly card, put the wait into the response's own `max-age` and let the edge absorb it. Retrying inside a ~10s budget mostly is not worth it.
- **No feature flag on the plaintext dual-write.** Deleting it later is a four-line diff.
- **No backfill script.** Lazy migration on read; accounts that never render simply stay on plaintext.
- **No crypto spec document or test vectors.** One round-trip test and one cross-user test. There is no second implementation to be interoperable with.
- **No key-rotation machinery.** The `v1:` prefix is kept because it costs nothing.
- **No warmup endpoint.** The cold start it worked around was an Admin SDK problem.

If you catch yourself designing a flag, a phase, a migration script or a runbook here, that is a signal to stop and pick the boring option.
