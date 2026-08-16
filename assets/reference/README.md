# Reference assets

Source images the widget's vector artwork was traced from. **Nothing here is served at runtime** - `src/render/icons.ts` contains inline SVG paths instead, because an SVG rendered inside an `<img>` cannot load external files, and paths are smaller, sharper, and recolourable per theme.

| File | Traced into |
| --- | --- |
| `spotify.svg` | `LOGO_PATH` - the header wordmark, from the Vercel app's own copy |
| `placeholder.webp` | `discPlaceholder()` - shown when a track has no cover art |

The Spotify logo is a Spotify trademark, included here for attribution in the widget header.
