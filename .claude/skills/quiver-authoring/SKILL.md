---
name: quiver-authoring
description: Create or edit quiver collections, environments, request files, tests (assertions), and capture chains. Use whenever the user asks to scaffold a collection, add an environment or request, write API tests, set up a login→token chain, or convert a curl command / endpoint description into a *.request.yaml file.
argument-hint: "[collection-dir] <what to create>"
---

# Authoring quiver collections

Everything in quiver is a plain file — creating a collection, environment, or
request means writing YAML; there is no registration step. Read
`reference.md` in this skill directory for the complete file format before
writing any file. The format is strict (zod-validated): unknown keys in
assertions and non-string header/query/form values are hard errors.

## Layout and naming

```
<collection-dir>/
├── collection.yaml              # required; marks the directory as a collection
├── environments/                # one <name>.yaml per environment
│   └── local.yaml
└── <folder>/                    # any nesting; folders group requests
    └── 01-login.request.yaml    # every request file ends in .request.yaml
```

- Requests run in **path order** (locale sort per directory, recursive).
  Use numeric prefixes (`01-`, `02-`) whenever order matters — capture
  chains depend on it.
- Filenames: kebab-case, descriptive, always the `.request.yaml` suffix
  (files without it are ignored).
- This repo keeps collections under `collections/`; a new collection is a
  new directory there unless the user says otherwise.

## Workflows

**New collection** — create the directory with a `collection.yaml` (name
required; put shared headers like `Accept` in `defaults.headers`) and at
least one environment in `environments/`. Put the base URL in an
environment variable (`baseUrl`), never hardcoded in request URLs.

**New environment** — add `environments/<name>.yaml` with a `variables`
map. Values must be strings. Secrets must be `{{$env.NAME}}` references,
never literal values — collections are committed to Git.

**New request** — one file per request. Prefer an `auth:` block over a
hand-written `Authorization` header (auth blocks get redacted in reports;
in-body or hand-rolled credentials do not). Give every request a `name:` —
it is what shows up in reports and the UI.

**From a curl command** — map `-X`→`method`, `-H`→`headers` (but move
`Authorization: Bearer …`→`auth:` block and content-type is implied by
`body.type`), `-d`/`--data-json`→`body`, URL query string→`query` map with
the bare URL in `url`. Replace the host with `{{baseUrl}}` and add it to
the environment.

**Tests** — every request should assert at least `status`. Derive the rest
from what the endpoint contract promises: a `jsonpath` check per field that
matters, `header`+`contains: application/json` for content type. Don't
assert volatile values (timestamps, generated IDs) with `equals` — use
`exists: true`.

**Chaining (login → token → authenticated call)** — the earlier request
`capture`s a value by JSONPath; later requests use it as `{{name}}`:

```yaml
# 01-login.request.yaml
capture:
  authToken: $.token
# 02-me.request.yaml
auth: { type: bearer, token: "{{authToken}}" }
```

Captures only flow forward within one `run`, so the files must sort in the
right order. `quiver send` on a later file alone will fail on unresolved
variables — that is expected, note it to the user.

## Verify (always do this after writing files)

```bash
[ -f packages/cli/dist/index.js ] || npm run build
npx quiver list <collection-dir>                 # parses + validates every file
npx quiver send <file> --env <name>              # execute one request
npx quiver run  <collection-dir> --env <name>    # execute the chain
```

`list` catches all schema errors without any network call — always run it.
Only `send`/`run` when the target API is reachable, and warn before
executing requests with side effects (POST/PUT/DELETE against a real
environment).
