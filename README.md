# Spotify Recently Played README — Vercel proxy

The card lives in a [Cloudflare Worker](https://github.com/JeffreyCA/spotify-recently-played-readme/tree/main) now. This branch is the shim that keeps the original Vercel endpoint working: it maps the old query parameters onto the new ones, forwards the request, and passes the SVG back.

**Nothing to do if you already use this** — your URL keeps working, and so does the Spotify account you authorized years ago, because the Worker reads the same Firebase database. For new cards, point at the Worker directly:

```markdown
![Spotify recently played](https://spotify-recently-played.jeffreyca.workers.dev/svg?user=jeffreyca16)
```

## Parameter mapping

The old endpoint took four parameters, and the Worker takes all four under the same names.

| Old parameter | Becomes |
| --- | --- |
| `user` | unchanged |
| `count` | unchanged, clamped to `1`–`10` instead of rejected |
| `width` | unchanged, clamped to `260`–`1000` instead of rejected |
| `unique` | unchanged |

Bad values are clamped or ignored rather than answered with a 400, which in a README is just a broken image. `theme` is forwarded if you add it, so old URLs can opt into the new palettes.

### Not carried over

- Cards use the Worker's default palette instead of `#212121`. Add `theme=legacy` for the old look.
- The card gains a now-playing row, timestamps, an explicit badge and hover tooltips, none of which the old renderer had. The [Worker's README](https://github.com/JeffreyCA/spotify-recently-played-readme/tree/main) lists the parameters that control them.
- Now playing needs a permission the original app never requested, so it stays hidden until you [reconnect](https://spotify-recently-played.jeffreyca.workers.dev/login).
- The profile is forced off by default, because the old header showed only the logo and "Recently Played". Add `profile=header` to your URL if you want your name and picture on the card.
- The internal `/api/proxy` image endpoint is gone; the Worker inlines album art itself.
- `/api/warmup` is gone. It existed to keep Firebase from cold-starting, and the Worker no longer sits behind that cold start on the render path.
- `/api/callback` is gone. Authorization now happens on the Worker, which has its own callback registered.

## Development

```bash
npm install
npm run dev        # vercel dev, on :3000
npm run typecheck
npm test
```

`WORKER_ORIGIN` points it at a different Worker, e.g. a local `wrangler dev`:

```bash
WORKER_ORIGIN=http://localhost:8787 npm run dev
```

Keep TypeScript on 5.x — Vercel's builder uses the compiler API, which 7.x doesn't expose.

Deployment is limited to this branch: set **Production Branch** to `vercel`, and **Ignored Build Step** to `bash -c '[ "$VERCEL_GIT_COMMIT_REF" != "vercel" ]'`.

## Licence

[MIT](LICENSE)

Not affiliated with Spotify; the Spotify name and logo are their trademarks.
