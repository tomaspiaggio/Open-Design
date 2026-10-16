# OpenDesign Studio

An open, model-agnostic workspace for AI-assisted presentations and reusable design systems. Built with React, TypeScript, Hono, tRPC, the Vercel AI SDK, OpenRouter, Prisma, PostgreSQL, and Tailwind CSS. Browser/server communication uses tRPC.

## Run locally

1. Copy `.env.example` to `.env` and set `OPENROUTER_API_KEY`.
2. Run `pnpm install` and `pnpm dev`. The dev command starts the local Postgres container, applies Prisma migrations, and launches the web app and tRPC API.
3. Open <http://localhost:5173>.

Stop the database with `pnpm db:down`; its Docker volume is retained. The model field accepts an OpenRouter model ID and defaults to `z-ai/glm-5.3-flash`.

## Product shape

- The home gallery offers registered creation strategies and shows recent projects with rendered thumbnails, modified dates, and stored source size.
- The current strategies are Presentation and Design System. Their creation prompts, starter artifacts, and agent instructions are separate strategy implementations in `src/strategies.ts`; add future workflows there.
- A project persists its strategy, HTML/CSS/JS files, conversation, preview thumbnail, and linked design system in PostgreSQL. The original HTML deck is imported on first database initialization.
- Presentations open in a fixed-viewport editor: conversation left, preview center, design-system controls right, and a horizontal slide filmstrip below. Slides can be targeted with `@slideN` or by clicking an element in the preview. PDF export and full-screen presenting are available.
- Design-system projects start from a private token copy, explore visual/component variants in the preview with a design-specific AI strategy, and can save their tokens as reusable systems. New presentations can choose one of those systems as their base.
- Design systems can import a shadcn/Tailwind v4 `globals.css`; its CSS variables are retained in the system and included in previews and the downloadable bundle. OpenDesign's own interface uses the Caffeine theme.
- After source changes, the agent receives a preview screenshot for visual review. Browser validation also checks for empty renders; when a generated artifact is blank, the last visible version is restored and the failed HTML is preserved under `recovery/empty-preview.html`.
- Design-system bundles include `tokens.json`, shadcn-compatible `theme.css`, and a legacy Tailwind preset for compatibility.

The model authors normal source files rather than a custom DSL. In-app drag/drop editing, threaded annotations, PowerPoint export, Electron, and React/JSX preview bundling remain out of scope for this iteration.

Checks: `pnpm typecheck`, `pnpm build`, and `pnpm --filter @opendesign/studio test`.
