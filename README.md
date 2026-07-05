# quiver

A Git-friendly API client and collection runner — a Postman replacement you
can code-review.

Collections are plain YAML files in your repository: one file per request,
folders for grouping, environments checked in alongside. A change to an
endpoint is a one-file diff a teammate can review in a normal PR. The same
collection runs from the CLI in CI and (milestone 3) from a point-and-click
web UI for non-technical users.

## Quick start

```bash
npm install
npm run build

# Run the demo collection against the public JSONPlaceholder API
node packages/cli/dist/index.js run collections/demo-api --env default

# Send a single request
node packages/cli/dist/index.js send collections/demo-api/users/01-list-users.request.yaml --env default

# See what's in a collection
node packages/cli/dist/index.js list collections/demo-api

# Generate a collection from an OpenAPI 3.x spec
node packages/cli/dist/index.js import openapi.yaml --out collections/my-api

# Open the point-and-click web UI (build it once with: npm run build:ui)
node packages/cli/dist/index.js ui collections/demo-api

# Or point it at a parent directory to manage several collections at once
node packages/cli/dist/index.js ui collections
```

## Collection format

A collection is a directory containing `collection.yaml`. Every
`*.request.yaml` beneath it is a request; requests run in path order, so
numeric prefixes (`01-login.request.yaml`) control sequencing.

```text
my-api/
├── collection.yaml            # name + shared defaults
├── environments/
│   ├── local.yaml
│   └── staging.yaml
└── auth/
    ├── 01-login.request.yaml
    └── 02-me.request.yaml
```

### Request file

```yaml
name: Create a post
method: POST
url: "{{baseUrl}}/posts"
headers:
  X-Trace: "abc"
query:
  verbose: "1"
auth:
  type: bearer            # none | bearer | basic | apikey
  token: "{{authToken}}"
body:
  type: json              # json | text | xml | csv | form
  content:
    title: Hello
tests:
  - status: 201
  - header: content-type
    contains: application/json
  - jsonpath: $.title
    equals: Hello
  - bodyContains: "Hello"
  - responseTimeBelow: 2000
capture:                  # extract values for later requests
  postId: $.id
```

### Variables

- `{{name}}` — resolved from the selected environment file, plus anything
  `capture`d by earlier requests in the run (this is how login → token →
  authenticated call chains work).
- `{{$env.NAME}}` — resolved from OS environment variables. **Use this for
  secrets** so they never land in Git:

```yaml
# environments/staging.yaml
variables:
  baseUrl: https://staging.example.com
  apiToken: "{{$env.STAGING_API_TOKEN}}"
```

### Assertions

| Assertion | Checks |
| --- | --- |
| `status: 200` | response status code |
| `header: <name>` + `equals`/`contains` | response header (case-insensitive) |
| `jsonpath: <path>` + `equals`/`contains`/`exists` | value in a JSON body |
| `bodyContains: <text>` | raw body substring |
| `responseTimeBelow: <ms>` | response time |

JSONPath support is the practical subset: `$.a.b`, `$[0]`, `$["key with spaces"]`.

## Importing an OpenAPI spec

```bash
quiver import openapi.yaml --out collections/my-api
```

Generates one request file per operation, grouped by tag, with:

- example request bodies synthesized from the JSON schemas (`example` /
  `default` / `enum` values win when present)
- path and query params filled from examples, or left as `{{param}}`
  placeholders that fail loudly until you supply a value
- security schemes mapped to auth blocks referencing `{{$env.*}}` — imported
  collections never contain literal secrets
- a status + content-type assertion per request, derived from the spec's
  `responses`

The importer prints warnings for anything it can't map (OAuth2 flows,
non-JSON bodies, missing server URLs) instead of guessing. OpenAPI 3.x only;
convert Swagger 2.0 specs first (e.g. `npx swagger2openapi`).

## CLI

```text
quiver send       <file>  [--env <name>] [--verbose]
quiver run        <dir>   [--env <name>] [--bail] [--reporter pretty|json|junit|html] [--output <file>] [--verbose]
quiver report     <file>  --format junit|html [--output <file>] [--name <name>]
quiver list       <dir>
quiver import     <spec>  --out <dir> [--force]
quiver export-k6  <dir>   --out <file> [--env <name>] [--vus <n>] [--duration <duration>]
quiver ui         <dir>   [--port <port>] [--no-open]   # <dir> = a collection or a workspace of collections
```

Exit codes: `0` all passed, `1` failures, `2` usage/config error — safe to
drop straight into CI.

### Reports for CI (JUnit, HTML)

```bash
quiver run my-api --env ci --reporter junit --output results.xml   # Jenkins/GitLab/GitHub test reports
quiver run my-api --env ci --reporter html  --output report.html   # a single self-contained artifact
```

Each assertion becomes its own JUnit testcase (`Login ➜ status is 200`), so a
test viewer shows exactly which check failed, not just which request.

The HTML report is a self-contained, clickable page written for people who
don't use quiver: summary stats, pass/fail filters, and one expandable card
per request showing its checks and the full exchange — the request as
actually sent (final URL, headers, body) and the complete response (status,
headers, body, pretty-printed when JSON). Credential headers (`Authorization`,
API-key headers, cookies) and captured values are redacted before they reach
the report or the JSON run file, so both are safe to attach to a ticket or
email. Request bodies appear exactly as sent, so prefer auth blocks over
in-body credentials where the API allows it. Response bodies are capped at
10 kB per request to keep reports a sane size.

If you need more than one format from a single run — the common case in CI — run
once with `--reporter json` and reformat the saved file, so the collection's
requests (and any side effects, like a POST creating a resource) never
execute twice:

```bash
quiver run my-api --env ci --reporter json --output run.json
quiver report run.json --format junit --output results.xml
quiver report run.json --format html  --output report.html
```

### GitHub Action

```yaml
# .github/workflows/api-tests.yml, in *your* repo
- uses: michael-baker-us/quiver/.github/actions/run@main
  with:
    collection: collections/my-api
    environment: ci
- uses: actions/upload-artifact@v4
  if: always()
  with:
    name: quiver-report
    path: |
      quiver-results.xml
      quiver-results.html
```

Runs the collection exactly once, publishes `passed`/`failed` step outputs
and a `$GITHUB_STEP_SUMMARY` line, and fails the step if anything failed.
quiver isn't published to a registry, so the action checks out and builds
its own source into `.quiver-tool/` before running — the standard pattern
for a composite action that ships a real CLI. See `.github/actions/run/action.yml`.

### k6 load-test export

```bash
quiver export-k6 my-api --env staging --out script.js --vus 20 --duration 2m
k6 run script.js
```

Generates a runnable [k6](https://k6.io) script from the collection: same
request order, same capture-based chaining (translated into real JS
variables), same assertions (as k6 `check()`s). `{{$env.NAME}}` secrets stay
dynamic — mapped to k6's own `-e NAME=value` mechanism — rather than baked
into the generated file; other `{{variables}}` are resolved once from the
chosen environment at export time. This is the bridge from "does this API
behave correctly" (quiver) to "does this API hold up under load" (k6) without
hand-translating requests.

## Web UI

```bash
npm run build:ui          # one-time (and after UI changes)
quiver ui my-api          # one collection
quiver ui collections/    # a workspace: every collection under the directory
```

A local web app for browsing, creating, editing, sending, and running
collections — aimed at teammates who won't touch a terminal. It edits the
same YAML files on disk, so every change made in the UI shows up in
`git diff`. Saves are validated against the request schema server-side; the
UI cannot produce a file the CLI would reject. The server binds to 127.0.0.1
only.

Point `quiver ui` at a directory containing several collections (any folder
with a `collection.yaml` up to three levels down) and the sidebar shows all
of them, Postman-style. The **+ New** button and per-item **⋯** menus create,
rename, and delete collections, folders, requests, and environments;
environments open in a key/value editor. Every one of those actions is an
ordinary file operation in your repository — a delete is a deleted file,
recoverable with `git checkout`, and a new collection is a new folder with a
`collection.yaml` you can commit. The environment picker and **▶ Run all**
apply to the active collection (the one you're working in), and each
collection remembers its own selected environment. An empty directory works
too: create your first collection from the UI.

The layout follows the conventions Postman users already know: method, URL,
and Send in a bar at the top, with Params / Headers / Auth / Body / Tests /
Capture tabs below it and the response docked underneath (status, time,
size, assertion results, syntax-highlighted JSON). The request/response
split is resizable by dragging the divider and can be flipped between
stacked and side-by-side layouts. The sidebar has a filter box and
collapsible folders; light and dark themes follow the OS with a manual
toggle. `⌘+Enter` sends, `⌘+S` saves.

After a **Run all**, the results panel offers the same JUnit XML and HTML
reports the CLI produces — generated from the run that just finished (via
the stateless `POST /api/report` endpoint), never by re-executing the
collection. The run stream carries a pre-redacted report entry per request,
so the downloadable HTML has the full request/response detail without the
browser ever holding a shareable copy of your credentials.

The **Guide** button in the top bar opens built-in documentation covering
the request format, variables, secrets, every assertion type, and
capture-based chaining — written for non-technical users, no README required.

Each request has two interchangeable views: **Form** (the tabbed editor — no
YAML knowledge needed) and **YAML** (the raw file text). Both edit the same
file; switching or saving from Form view rewrites the file from its fields,
so comments or non-standard fields only survive while you stay in YAML view.

For UI development: `quiver ui <dir> --port 4123 --no-open` in one terminal,
`npm -w @quiver/ui run dev` (Vite with `/api` proxy) in another.

## Architecture

```text
packages/
├── core/    # engine: schema (zod), loader, {{var}} resolution, HTTP
│            # execution, assertions, runner, OpenAPI import, k6 export.
│            # No CLI or UI dependencies.
├── cli/     # thin client of core: commands + reporters (json/junit/html)
└── server/  # local HTTP server: JSON API over core + hosts the built UI
apps/
└── ui/      # React frontend (Vite); builds into packages/server/public
.github/
├── actions/run/  # composite GitHub Action wrapping `quiver run`
└── workflows/    # this repo's own CI (unit tests + a dogfooding API-test job)
```

The core package is the product; the CLI (and the future web UI) are thin
clients. Anything a client can do must be expressible through core's API —
that discipline is what keeps the GUI and CLI behavior identical.

## Roadmap

- [x] **M1 — engine + CLI runner**: YAML collection format, environments,
      secrets via `$env`, assertions, capture/chaining, pretty + JSON reporters
- [x] **M2 — OpenAPI import**: generate a collection skeleton from a spec
- [x] **M3 — web UI**: `quiver ui` opens a local app; reads/writes the same
      YAML files, aimed at non-technical teammates
- [x] **M4 — integrations**: JUnit XML reporter (Jenkins/GitLab), HTML report,
      GitHub Action, k6 script export
- [x] Form-based request editor in the UI (alongside YAML view)
- [x] Multi-collection workspaces: create/rename/delete collections, folders,
      requests, and environments from the UI; environment key/value editor
- [ ] Later: cookies/sessions, file upload, request scripts, parallel runs,
      watch mode (auto-refresh on external file changes), a JMeter/Newman
      export alongside k6

## Development

```bash
npm test          # vitest (unit + integration against a local http server)
npm run build     # tsc project references
```
