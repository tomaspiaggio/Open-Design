# OpenDesign

OpenDesign is an open, model-agnostic workspace for creating HTML presentations and reusable design systems with an AI design partner. Projects are stored in PostgreSQL, remain editable as ordinary source files, and can be reviewed in a live browser preview. Presentations can be presented full screen and exported to PDF.

The current app is an early, local-first web studio. It uses OpenRouter for model access; the model ID is configurable in the UI. The codebase is structured so additional project strategies can be added without changing the core project lifecycle.

## Features

- HTML/CSS/JavaScript as the editable project artifact.
- AI conversations with slide/component targeting, tool-call activity, and screenshot-based visual review.
- Live Markdown-rendered assistant responses and keyboard navigation while presenting.
- Presentation and design-system creation strategies.
- Reusable design-system tokens, shadcn theme import/export, and project-level system selection.
- Real rendered previews, per-slide thumbnails, PDF export, and presentation mode.
- Persistent agent run history, token usage, and database-table activity.
- tRPC communication between the React client and Hono server.

## Stack

- React, TypeScript, Vite, Tailwind CSS
- Hono + tRPC
- AI SDK with the OpenRouter provider
- PostgreSQL + Prisma
- pnpm + Turborepo
- Playwright/Chromium for previews, validation, thumbnails, and PDF output

## Requirements

- Node.js 22 or newer
- pnpm 10
- Docker with Docker Compose (for the local PostgreSQL container)
- An OpenRouter API key to run agent turns

## Quick start

```sh
pnpm install
cp .env.example .env
```

Add your key to `.env`:

```dotenv
OPENROUTER_API_KEY=your-openrouter-api-key
DATABASE_URL=postgresql://opendesign:opendesign@localhost:5432/opendesign?schema=public
```

Start the database, apply Prisma migrations, and launch the web app and API:

```sh
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173). The tRPC API runs at `http://localhost:8787/trpc`.

To stop the local PostgreSQL container:

```sh
pnpm db:down
```

## Common commands

```sh
pnpm typecheck                 # Type-check all workspace packages
pnpm --filter @opendesign/studio test
pnpm build                     # Build all workspace packages
pnpm db:up                     # Start PostgreSQL only
pnpm db:down                   # Stop PostgreSQL
```

Schema changes belong in `apps/studio/prisma/schema.prisma`. Create and apply a development migration with:

```sh
DATABASE_URL='postgresql://opendesign:opendesign@localhost:5432/opendesign?schema=public' \
  pnpm --filter @opendesign/studio exec prisma migrate dev --name describe_change
```

## Repository layout

```text
apps/studio/
  prisma/        Database schema and migrations
  src/main.tsx   React studio and project gallery
  src/server.ts  Hono/tRPC API, AI agent, rendering and export
  src/db.ts      Prisma persistence layer
  src/strategies.ts
                 Strategy registry for project types
packages/
  acme-system/   Example reusable design-system package
```

The strategy registry currently includes `presentation` and `design-system`. A strategy defines its starter source, agent instructions, preview mode, file layout, and export capabilities. To add another strategy, implement those properties in `apps/studio/src/strategies.ts` and keep project-specific behavior behind that interface.

## Agent telemetry

Each agent run is persisted in the `AgentRun` table, with an ordered event trail in `AgentRunEvent`. The model middleware records provider-reported input/output token counts; tool activity records the relevant PostgreSQL tables (for example `ProjectFile`, `Project`, and `DesignSystem`). The project editor's **Activity** tab shows recent runs, token totals, events, and table access. Token counts depend on the model provider reporting usage; unavailable provider counts may be recorded as zero.

## UI screenshots

Pull requests that touch the studio UI automatically capture the project gallery, presentation editor, design-system editor, and agent activity view with deterministic database fixtures. The screenshots are uploaded as a GitHub Actions artifact linked from the PR; no external image storage or model calls are used. See [.agents/skills/ui-screenshots/SKILL.md](.agents/skills/ui-screenshots/SKILL.md) for local capture instructions.

## Data and security notes

- This is currently a local development app, not a multi-user hosted service. It has no authentication or authorization layer.
- Project source files, conversation messages, design systems, and agent telemetry are stored in PostgreSQL.
- AI requests are sent to OpenRouter using the configured model and API key.
- Generated project HTML is rendered in a sandboxed iframe. Treat imported or generated source as untrusted when changing the sandbox policy.
- The database container uses development credentials from `docker-compose.yml`; do not reuse them for a production deployment.

## License

OpenDesign is licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for the complete text.
