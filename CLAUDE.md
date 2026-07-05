# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**quiver** — a Git-friendly API client and collection runner (Postman replacement). Collections are plain YAML files on disk: one `*.request.yaml` file per request, run in path order (numeric prefixes control sequencing), with environments checked in alongside. The same engine runs from a CLI (for CI) and a local web UI. See README.md for the full request/assertion/variable format.

## Commands

```bash
npm run build       # tsc project references: core → cli + server (required before running the CLI)
npm run build:ui    # builds the React UI into packages/server/public (required before `quiver ui`)
npm test            # vitest run — all packages
npm run test:watch
npm run clean       # removes dist/ and tsbuildinfo

# Single test file / single test
npx vitest run packages/core/test/runner.test.ts
npx vitest run packages/core/test/runner.test.ts -t "name of test"

# Run the CLI from source (after npm run build)
npx quiver run collections/demo-api --env default
npx quiver send collections/demo-api/users/01-list-users.request.yaml --env default
```

UI development (two terminals, avoids rebuilding on every change):

```bash
npx quiver ui collections --port 4123 --no-open   # API server
npm -w @quiver/ui run dev                         # Vite dev server with /api proxy
```

## Architecture

npm workspaces monorepo, ESM throughout (`"type": "module"`, relative imports use `.js` extensions), TypeScript project references, Node ≥ 20.

```
packages/core/    # THE PRODUCT: schema (zod), loader, {{var}} resolution, HTTP
                  # execution, assertions, runner, report/redaction, OpenAPI
                  # import, k6 export. No CLI or UI dependencies.
packages/cli/     # thin client: commander commands + reporters (pretty/json/junit/html)
packages/server/  # single-file Node http server (no framework): JSON API over
                  # core + serves the built UI. Binds 127.0.0.1 only.
apps/ui/          # React (Vite) frontend; `build:ui` outputs to packages/server/public
```

**Core is the product; CLI and UI are thin clients.** Anything a client needs must be expressible through core's exported API (`packages/core/src/index.ts` re-exports every module). This discipline is what keeps CLI and GUI behavior identical — don't put request-execution, validation, or file-mutation logic in the CLI, server, or UI.

Key core modules:
- `schema.ts` — zod schemas for request/collection/environment YAML; the server validates UI saves against these, so the UI can't write a file the CLI would reject
- `runner.ts` / `http.ts` / `assertions.ts` — execution pipeline; `capture` feeds JSONPath-extracted values into later requests' `{{variables}}`
- `variables.ts` — `{{name}}` from environment + captures; `{{$env.NAME}}` from OS env (the secrets mechanism)
- `mutations.ts` / `workspace.ts` — file operations (create/rename/delete) the server exposes; every UI action is an ordinary file edit visible in `git diff`
- `report.ts` — run-file model + **credential redaction** (auth headers, cookies, captured values) applied before data reaches any report or the UI's run stream; response bodies capped at 10 kB

## Testing

- Root `vitest.config.ts` picks up `packages/*/test/**/*.test.ts` and `apps/*/test/**/*.test.ts`; everything runs in the node environment (no DOM).
- UI logic is deliberately extracted into plain-TS modules (`sidebarTree.ts`, `requestFormData.ts`, `varHighlight.ts`, …) so it's unit-testable without a browser; keep new UI logic in such modules rather than inside components.
- HTTP tests spin up a local server; core tests use fixtures in `packages/core/test/fixtures`.

## CI and collections/

- `.github/workflows/ci.yml`: unit tests + a dogfooding job that runs `collections/demo-api` against the public JSONPlaceholder API via the built CLI (json reporter, then `quiver report` to junit/html — run once, reformat, never re-execute).
- `.github/actions/run/` is a composite action for *consumer* repos (it checks out and builds quiver itself); this repo's own CI calls the CLI directly instead.
- `collections/` holds demo/dogfood collections used by CI and manual testing.

## Conventions

- CLI exit codes are contractual: `0` all passed, `1` failures, `2` usage/config error.
- The OpenAPI importer warns on anything it can't map instead of guessing, and maps security schemes to `{{$env.*}}` so imported collections never contain literal secrets — preserve both behaviors when extending it.
- Request YAML round-trips through the UI's Form view (rewritten from fields on save); only YAML view preserves comments.
