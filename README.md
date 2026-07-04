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
node packages/cli/dist/index.js run examples/demo-api --env default

# Send a single request
node packages/cli/dist/index.js send examples/demo-api/users/01-list-users.request.yaml --env default

# See what's in a collection
node packages/cli/dist/index.js list examples/demo-api

# Generate a collection from an OpenAPI 3.x spec
node packages/cli/dist/index.js import openapi.yaml --out collections/my-api

# Open the point-and-click web UI (build it once with: npm run build:ui)
node packages/cli/dist/index.js ui examples/demo-api
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
  type: json              # json | text | form
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
quiver send   <file>  [--env <name>] [--verbose]
quiver run    <dir>   [--env <name>] [--bail] [--reporter pretty|json] [--verbose]
quiver list   <dir>
quiver import <spec>  --out <dir> [--force]
quiver ui     <dir>   [--port <port>] [--no-open]
```

Exit codes: `0` all passed, `1` failures, `2` usage/config error — safe to
drop straight into CI:

```yaml
# .github/workflows/api-tests.yml (example step)
- run: node packages/cli/dist/index.js run collections/my-api --env ci --reporter json
```

## Web UI

```bash
npm run build:ui          # one-time (and after UI changes)
quiver ui my-api          # opens http://127.0.0.1:4123
```

A local web app for browsing, creating, editing, sending, and running the
collection — aimed at teammates who won't touch a terminal. It edits the
same YAML files on disk, so every change made in the UI shows up in
`git diff`. Saves are validated against the request schema server-side; the
UI cannot produce a file the CLI would reject. The server binds to 127.0.0.1
only.

The **📖 Guide** button in the top bar opens built-in documentation covering
the request format, variables, secrets, every assertion type, and
capture-based chaining — written for non-technical users, no README required.

For UI development: `quiver ui <dir> --port 4123 --no-open` in one terminal,
`npm -w @quiver/ui run dev` (Vite with `/api` proxy) in another.

## Architecture

```text
packages/
├── core/    # engine: schema (zod), loader, {{var}} resolution, HTTP
│            # execution, assertions, runner, OpenAPI import.
│            # No CLI or UI dependencies.
├── cli/     # thin client of core: commands + reporters
└── server/  # local HTTP server: JSON API over core + hosts the built UI
apps/
└── ui/      # React frontend (Vite); builds into packages/server/public
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
- [ ] **M4 — integrations**: JUnit XML reporter (Jenkins/GitLab), HTML report,
      GitHub Action, k6 script export
- [ ] Later: form-based request editor in the UI, new-request/delete from the
      UI, cookies/sessions, file upload, request scripts, parallel runs,
      watch mode

## Development

```bash
npm test          # vitest (unit + integration against a local http server)
npm run build     # tsc project references
```
