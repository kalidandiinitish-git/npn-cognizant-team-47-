# Assets

Intentionally light. The interface uses no raster images:

- Icons are inline SVG paths in `src/components/Icons.jsx`, so they inherit
  `currentColor` and add no network requests.
- The logo and favicon are hand-written SVG (`Icons.jsx` and `public/favicon.svg`).
- Charts are drawn by Recharts from live data.
- Fonts are Inter and JetBrains Mono, loaded from Google Fonts in `index.html`.

Put static images here if any are added later; Vite will fingerprint anything
imported from `src/`.
