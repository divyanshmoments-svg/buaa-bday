# For Buaa · October 20

A warm, minimal birthday keepsake: a greeting, a photo album, a personal letter, and a little candle to wish on. Built with plain HTML, CSS, and JavaScript. No framework, runtime dependencies, accounts, or backend.

## Preview

Use **Node.js 22 or newer**. No `npm install` is needed.

```bash
npm run dev
```

Open **http://localhost:5173**. To use another port:

```bash
npm run dev -- --port 5174
```

The Node script is only a local static-file server. It correctly maps `public/` assets to the website root; opening `index.html` directly or using Python's server at the project root will not use this mapping or generate the photo list.

## Make it yours

### 1. Add your real photographs

Put photos in **`public/images/`**. JPG, JPEG, PNG, WebP, AVIF, and GIF are supported, including nested folders and filenames with spaces. No stock or generated photographs are included.

- Name the preferred hero portrait **`buaa-portrait.jpg`** (another supported extension works too).
- Name other photos **`memory-01.jpg`**, **`memory-02.jpg`**, etc. to control their order, or use your own filenames.
- Refresh the development page after adding files. All photos are discovered automatically; the first photo becomes the portrait when no named portrait exists. The remaining photos form the gallery. A single photo is shown in both places.
- With no photos, decorative keepsake cards appear without requesting missing image URLs. A photo that cannot load leaves a graceful placeholder.
- Tap a loaded photo to view it uncropped. The viewer supports next/previous controls, arrow keys, Escape, and horizontal swipes on phones.

For faster loading on phones, export photos around 1600–2000 px on the longest side, ideally below 500 KB. Strip location/EXIF metadata before sharing if desired. Any non-hidden file in `public/` is public in the built site, so put only intended assets there.

### 2. Personalize the words

Edit **`index.html`**:

- Greeting and subtitle: look for `hero-title` and `hero-subtitle`.
- Letter: search for **`PERSONALIZE`**. Change the greeting, paragraphs, and signature. The letter is also editable on the page; edits are saved locally in that browser, while source edits are what get included when you share the site.
- Final wish: edit the paragraph beneath `surprise-title`.

Edit **`script.js`**:

- `PHOTO_DETAILS` at the top sets optional captions and accurate image descriptions. Keys must match the full filename relative to `public/images/`, including any subfolder. Every unlisted photo receives a neutral caption and alt text; replace these with meaningful descriptions of your actual photos.
- The `wishMessage.textContent` strings near the end set the message after the candle is blown out or relit.

Colors, spacing, and font choices are CSS variables at the top of **`styles.css`**. Google Fonts supplies Playfair Display and DM Sans; local serif/sans-serif fallbacks keep the site readable if the fonts are unavailable. All other functionality is self-contained.

## Validate and publish

```bash
npm run check   # JavaScript syntax, HTML basics, safe asset paths
npm test        # Node built-in static tooling tests
npm run build  # Production files in dist/
npm run preview
```

Preview is also at http://localhost:5173; stop the development server first or pass `--port 5174`. Rebuild after changing text or photos. Upload the **contents of `dist/`** to any static host at the domain root. No Node server is needed after publishing. Root-relative paths such as `/images/buaa-portrait.jpg` assume deployment at `/`, not a repository subpath.

The page supports keyboard navigation, visible focus indicators, a modal photo viewer with native focus trapping, readable contrast, and the operating system's reduced-motion preference. The written gift is still visible without JavaScript; the interactive candle and automatic photo gallery require it.
