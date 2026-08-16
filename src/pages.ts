import { escapeXml } from './render/escape';

/**
 * The handful of HTML pages the OAuth flow needs.
 *
 * Inline styles and no assets: these are three pages nobody bookmarks, and a
 * stylesheet request would be more machinery than the content justifies. The
 * configurator in `public/` is where the real UI lives.
 */

const STYLE = `
  :root { color-scheme: dark }
  * { box-sizing: border-box }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: #0d1117; color: #e6edf3; padding: 24px;
    font: 15px/1.55 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  }
  main { width: 100%; max-width: 640px }
  h1 { font-size: 22px; margin: 0 0 8px }
  p { margin: 0 0 16px; color: #9198a1 }
  .card { background: #151b23; border: 1px solid #2a323d; border-radius: 12px; padding: 24px }
  .mark { width: 34px; height: 34px; display: block; margin-bottom: 14px }
  code, pre {
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 13px;
  }
  pre {
    background: #0d1117; border: 1px solid #2a323d; border-radius: 8px;
    padding: 12px 14px; overflow-x: auto; margin: 0 0 12px; color: #e6edf3;
  }
  .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center }
  a.btn, button {
    font: inherit; font-weight: 600; border-radius: 999px; padding: 9px 18px;
    border: 1px solid transparent; cursor: pointer; text-decoration: none;
    display: inline-block;
  }
  a.btn { background: #1db954; color: #0d1117 }
  a.btn.danger { background: #f85149; color: #0d1117 }
  a.btn.ghost { background: transparent; color: #e6edf3; border-color: #2a323d }
  button { background: transparent; color: #e6edf3; border-color: #2a323d }
  ul { margin: 0 0 16px; padding-left: 20px; color: #9198a1 }
  li { margin-bottom: 4px }
  .muted { font-size: 13px; color: #6e7681 }
  img.preview { max-width: 100%; margin-top: 8px; border-radius: 10px }
`;

/** The circle mark alone, so the pages carry Spotify attribution too. */
const MARK = `<svg class="mark" viewBox="0 0 168 168" aria-hidden="true" fill="#1db954"><path d="m83.996 0.277c-46.249 0-83.743 37.493-83.743 83.742 0 46.251 37.494 83.741 83.743 83.741 46.254 0 83.744-37.49 83.744-83.741 0-46.246-37.49-83.738-83.745-83.738l0.001-0.004zm38.404 120.78c-1.5 2.46-4.72 3.24-7.18 1.73-19.662-12.01-44.414-14.73-73.564-8.07-2.809 0.64-5.609-1.12-6.249-3.93-0.643-2.81 1.11-5.61 3.926-6.25 31.9-7.288 59.263-4.15 81.337 9.34 2.46 1.51 3.24 4.72 1.73 7.18zm10.25-22.802c-1.89 3.072-5.91 4.042-8.98 2.152-22.51-13.836-56.823-17.843-83.448-9.761-3.453 1.043-7.1-0.903-8.148-4.35-1.04-3.453 0.907-7.093 4.354-8.143 30.413-9.228 68.222-4.758 94.072 11.127 3.07 1.89 4.04 5.91 2.15 8.976v-0.001zm0.88-23.744c-26.99-16.031-71.52-17.505-97.289-9.684-4.138 1.255-8.514-1.081-9.768-5.219-1.254-4.14 1.08-8.513 5.221-9.771 29.581-8.98 78.756-7.245 109.83 11.202 3.73 2.209 4.95 7.016 2.74 10.733-2.2 3.722-7.02 4.949-10.73 2.739z"/></svg>`;

function page(title: string, body: string): Response {
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${escapeXml(title)}</title><style>${STYLE}</style></head>` +
    `<body><main class="card">${MARK}${body}</main></body></html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // These pages are per-user and short-lived; never let a proxy hold one.
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

export function connectedPage(userId: string, baseUrl: string): Response {
  const cardUrl = `${baseUrl}/svg?user=${encodeURIComponent(userId)}`;
  const snippet = `![Spotify recently played](${cardUrl})`;

  return page(
    'Connected to Spotify',
    `<h1>You're connected</h1>` +
      `<p>Paste this into your profile README:</p>` +
      `<pre id="snippet">${escapeXml(snippet)}</pre>` +
      `<div class="row">` +
      `<button type="button" onclick="navigator.clipboard.writeText(document.getElementById('snippet').textContent).then(()=>{this.textContent='Copied'})">Copy</button>` +
      `<a class="btn" href="/?user=${encodeURIComponent(userId)}">Customize the card</a>` +
      `</div>` +
      `<img class="preview" src="${escapeXml(cardUrl)}" alt="Preview of your card">` +
      `<p class="muted">Signed in as <code>${escapeXml(userId)}</code>. ` +
      `You can <a href="/disconnect">disconnect</a> at any time.</p>`,
  );
}

export function confirmDisconnectPage(): Response {
  return page(
    'Disconnect from Spotify',
    `<h1>Disconnect this app?</h1>` +
      `<p>Spotify will ask you to sign in so we know whose tokens to delete. After that:</p>` +
      `<ul>` +
      `<li>The tokens stored for your account are deleted.</li>` +
      `<li>Any card using your username stops working, including ones already embedded in a README.</li>` +
      `<li>You can reconnect later, but you will have to authorize again.</li>` +
      `</ul>` +
      `<p class="muted">This does not revoke the app on Spotify's side - see the next page.</p>` +
      `<div class="row">` +
      `<a class="btn danger" href="/disconnect?confirm=1">Yes, disconnect</a>` +
      `<a class="btn ghost" href="/">Cancel</a>` +
      `</div>`,
  );
}

export function disconnectedPage(userId: string): Response {
  return page(
    'Disconnected',
    `<h1>Disconnected</h1>` +
      `<p>The tokens stored for <code>${escapeXml(userId)}</code> have been deleted, and any card ` +
      `using that username will stop working.</p>` +
      // Worth being explicit about: deleting our copy is not the same as
      // revoking the grant, and someone disconnecting probably wants both.
      `<p><strong>This does not revoke access on Spotify's side.</strong> To remove this app from ` +
      `your Spotify account, visit ` +
      `<a href="https://www.spotify.com/account/apps" target="_blank" rel="noopener noreferrer">` +
      `spotify.com/account/apps</a>.</p>` +
      `<div class="row"><a class="btn" href="/login">Connect again</a></div>`,
  );
}

export function errorPage(title: string, detail: string, status = 400): Response {
  const response = page(
    title,
    `<h1>${escapeXml(title)}</h1><p>${escapeXml(detail)}</p>` +
      `<div class="row"><a class="btn" href="/">Back to the configurator</a></div>`,
  );
  return new Response(response.body, { status, headers: response.headers });
}
