# Expense Splitter

Split shared expenses evenly or by percentage and settle up with minimal transfers. All math uses integer cents and basis points in a pure TypeScript domain, persisted locally in `localStorage`.

## Quick Start

```sh
pnpm install
pnpm dev       # http://localhost:3000
pnpm test
pnpm typecheck
pnpm build
```

## Structure

- `src/domain/` — Money, split, balance, settlement, and validation logic
- `src/state/` — Reducer and state hook
- `src/storage/` — `localStorage` persistence adapter
- `src/components/` — UI components
- `src/app/` — Next.js App Router entrypoint and styles
