# hover-app

HoverAI desktop application — an AI-powered on-screen assistant that hears your voice commands and sees what's on your screen to give contextual, step-by-step guidance.

Built with **Electron 39 + React 19 + TypeScript + Tailwind CSS v4 + Framer Motion**.

---

## Stack

| Layer | Technology |
|---|---|
| Shell | Electron 39 |
| Renderer | React 19 + TypeScript |
| Styling | Tailwind CSS v4 (no config file — tokens in `src/renderer/src/assets/base.css`) |
| Animation | Framer Motion 13 |
| Icons | Remix Icon 4 |
| Build | electron-vite 5 |
| Package manager | pnpm |

---

## Project Setup

```bash
pnpm install
```

---

## Development

```bash
pnpm dev        # starts Electron with HMR renderer on :5173
pnpm typecheck  # run both node + web typechecks
pnpm lint       # eslint
pnpm format     # prettier
```

---

## Build

```bash
# macOS  (note: skips typecheck — run pnpm typecheck first)
pnpm build:mac

# Windows
pnpm build:win

# Linux
pnpm build:linux

# Unpackaged dir (for inspection)
pnpm build:unpack
```

---

## Source layout

```
src/
├── main/           # Electron main process (Node.js)
│   └── index.ts    # BrowserWindow creation, IPC handlers
├── preload/
│   ├── index.ts    # contextBridge — exposes window.electron + window.api
│   └── index.d.ts  # Type declarations for window.api
└── renderer/
    └── src/
        ├── assets/
        │   ├── base.css   # CSS custom properties (design tokens)
        │   └── main.css   # Global styles, Tailwind import
        ├── components/
        │   ├── AuthPanel.tsx   # Purple left panel with orbiting feature illustration
        │   ├── Logo.tsx        # HoverAI wordmark + icon SVG
        │   └── RemixIcon.tsx   # Remix icon wrapper component
        └── pages/
            ├── AuthPage.tsx        # Sign In / Create Account (onboarding step 1)
            └── PermissionsPage.tsx # Grant device access (onboarding step 2)
```

---

## Onboarding flow

```
AuthPage  ──(submit)──▶  PermissionsPage  ──(both granted)──▶  Main app
  Sign In / Create Account     Microphone + Screen recording
```

---

## Key conventions

- Path alias `@renderer/*` maps to `src/renderer/src/*`
- **No** `tailwind.config.*` — add design tokens inside `@theme {}` in `base.css`
- New IPC methods: add to `api` object in `preload/index.ts`, declare type in `preload/index.d.ts`, call via `window.api.*` in renderer
- `build:mac` does **not** run typecheck — always run `pnpm typecheck` before a mac release
- Window is fixed at **1200 × 800**, non-resizable (`resizable: false` in `main/index.ts`)
