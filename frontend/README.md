# Frontend (Vite + React)

## Setup
```bash
npm ci
cp .env.example .env   # optional
npm run dev
```

## Scripts
- `npm run dev` - start dev server
- `npm run build` - production build
- `npm run preview` - preview production build
- `npm run lint` - run eslint

## Environment Variables
- `VITE_API_URL` - optional absolute API base URL. Leave empty to use the dev proxy.
- `VITE_FORCE_OPTIMIZE_DEPS` - set `true` only when forcing Vite prebundle.
