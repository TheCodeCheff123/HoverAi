# Landing Page

The Hover AI marketing site — built with React 19, Vite 8, Tailwind CSS v4, and TypeScript.

---

## Requirements

- [Node.js](https://nodejs.org/) 20 or later
- [pnpm](https://pnpm.io/) 9 or later (`npm install -g pnpm`)

---

## Local development

```bash
# Install dependencies
pnpm install

# Start the dev server at http://localhost:5173
pnpm dev
```

---

## Production build

```bash
# Type-check and bundle
pnpm build

# Preview the production build locally
pnpm preview
```

The output goes to `dist/`. The build is a fully static SPA — no server required.

---

## Deploying to Vercel

The project includes a [`vercel.json`](./vercel.json) that handles SPA routing (all paths rewrite to `index.html`) and sets cache and security headers. Deploying is a one-step import:

1. Push the repo to GitHub.
2. In the [Vercel dashboard](https://vercel.com/new), import the repository.
3. Set the **Root Directory** to `landing_page`.
4. Leave the framework preset as **Vite** — Vercel detects it automatically.
5. Click **Deploy**.

Vercel will run `pnpm build` and serve the `dist/` output. No environment variables are required for the landing page.

### Before going live

Update the following in [`index.html`](./index.html) to match your actual domain:

- `<link rel="canonical" href="https://hoverai.app" />`
- All `og:url`, `og:image`, `twitter:image` meta tags
- The three `url` fields in the JSON-LD structured data blocks

---

## Project structure

```
landing_page/
├── assets/
│   ├── fonts/          # Local .otf font files (CreatoDisplay, NeueMachina)
│   └── images/
│       ├── hero.png    # LCP hero image — preloaded in index.html
│       └── tools/      # Tool logos — drop a .png here to add it to the marquee
├── public/
│   ├── robots.txt
│   ├── sitemap.xml
│   ├── logo.png
│   └── og-image.png
├── src/
│   ├── components/     # Header, Footer, FadeUp, RemixIcon, Logo
│   ├── data/tools.ts   # Auto-discovers tool logos via import.meta.glob
│   ├── pages/
│   │   └── LandingPage.tsx
│   ├── index.css       # Tailwind v4 entry point + @theme design tokens
│   └── main.tsx
├── index.html
├── vite.config.ts
├── vercel.json
└── tsconfig.json
```

### Design tokens

There is no `tailwind.config.*` file. All colour and spacing tokens are defined inside `@theme {}` in [`src/index.css`](./src/index.css). Edit them there.

### Adding a tool logo to the marquee

Drop any `.png` into `assets/images/tools/` and it will appear in the scrolling tools marquee automatically — no code changes needed.
