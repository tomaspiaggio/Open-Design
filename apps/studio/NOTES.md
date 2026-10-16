# Product validation and architecture

## Current implementation

- Strategy registry: presentation and design-system workflows have independent setup, starter source, and agent instructions.
- Project gallery stores project metadata, source files, messages, linked design systems, and preview thumbnails in PostgreSQL via Prisma.
- The existing HTML deck is imported into PostgreSQL on first run. Source files written by the AI agent are persisted in `ProjectFile` records.
- Studio layout is fixed to the viewport; chat, inspector, and filmstrip scroll independently where needed.
- New design-system projects receive a cloned token record, which can be selected as the base for future presentations.
- PDF, slide targeting, browser screenshot review, and activity feed remain available.

## Architecture decisions

- React + TypeScript frontend; Hono hosts the tRPC API.
- All frontend/backend communication uses tRPC.
- OpenRouter + AI SDK keeps model selection provider-independent.
- Postgres via Prisma is the source of truth for projects and design-system token data. The filesystem copy of design-system exports is a compatibility/export artifact.
- Project strategies are registered in `src/strategies.ts`; each strategy defines creation metadata, starter HTML, first question, and agent instructions.
- HTML/CSS/JS source remains ordinary editable code, not a custom design DSL.

## Deliberately deferred

- Electron packaging; web is the primary target.
- Direct canvas editing and independent threaded comment objects.
- PowerPoint export, React/JSX preview bundling, and additional creation strategies such as UI prototypes.
