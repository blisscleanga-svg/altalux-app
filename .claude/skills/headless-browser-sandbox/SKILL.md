---
name: headless-browser-sandbox
description: Run a real headless Chromium (via Playwright) against this project's HTML apps or the live production site, in this sandbox, where sudo has no password and Chromium's shared libs (libnspr4, libnss3, libasound2) aren't installed system-wide. Use whenever you need to actually drive booking/admin/technician in a browser, take screenshots, or capture real console/network errors — not just read the HTML.
---

# Headless browser in this sandbox (no sudo, no Docker)

This container has no passwordless `sudo`, so `npx playwright install-deps`
fails. But `apt-get download` (fetches a `.deb` without installing it) and
`dpkg-deb -x` (extracts a `.deb` into an arbitrary directory) both work as a
normal user. Combine that with `LD_LIBRARY_PATH` and Playwright launches fine.

The Chromium **binary** itself is usually already cached at
`~/.cache/ms-playwright/chromium-*` (check with
`find ~/.cache/ms-playwright -maxdepth 1`) — only the OS shared libraries are
missing, not the browser.

## One-time-per-session setup

```bash
WORKDIR=/tmp/claude-*/*/*/scratchpad/e2e   # or any scratch dir
mkdir -p "$WORKDIR" && cd "$WORKDIR"
npm init -y >/dev/null 2>&1
npm install playwright@1.61.1   # match the version `npx playwright --version` reports

mkdir -p localdeps && cd localdeps
apt-get download libnspr4 libnss3 libasound2t64 libasound2-data
mkdir -p root
for f in *.deb; do dpkg-deb -x "$f" root; done
cd ..
```

If a script still crashes with `error while loading shared libraries: libX.so`,
add that package name to the `apt-get download` line and re-extract — the
27-package list from `npx playwright install-deps chromium --dry-run` is the
reference for what Ubuntu normally installs, but in practice only a handful
(nspr/nss/asound) are actually required for headless screenshots+console.

## Every run

Export `LD_LIBRARY_PATH` before invoking node:

```bash
export LD_LIBRARY_PATH="$WORKDIR/localdeps/root/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH"
node your_script.js
```

## Minimal driver script pattern

```js
const { chromium } = require('playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('console', msg => { if (msg.type() === 'error') console.log('[console]', msg.text()); });
page.on('response', async res => {
  if (res.status() >= 400) console.log(res.status(), res.url(), await res.text().catch(()=>''));
});
await page.goto('https://app.altaluxdetail.com/booking/', { waitUntil: 'networkidle' });
// ...interact, screenshot, read response bodies of specific failing requests...
```

Reading the actual response **body** of a failing network request (not just
the generic SDK error message) is what turned "Square card form is not
loading" into a precise `AUTHENTICATION_ERROR / UNAUTHORIZED` from
`pci-connect.squareup.com/payments/hydrate` — always capture bodies for any
`res.status() >= 400`, not just the status code.

## Gotchas

- `background-attachment: fixed` + `page.screenshot({ fullPage: true })` can
  paint white outside the first viewport height in headless Chromium — before
  reporting a "text is invisible" bug, re-check with a normal (non-fullPage)
  screenshot after `window.scrollTo(...)`.
- Locator text like `button:has-text("Edit")` can match hidden buttons
  elsewhere on the page (e.g. a job's "Edit Status") — scope to the visible
  view's container id, e.g. `#view-employees button:has-text("Edit")`.
