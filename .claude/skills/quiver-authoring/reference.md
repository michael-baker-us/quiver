# quiver YAML file formats

Authoritative source: `packages/core/src/schema.ts` (zod). This file mirrors
it — if they ever disagree, the schema wins.

## collection.yaml

```yaml
name: My API            # required
description: >          # optional
  What this collection covers.
defaults:               # optional; merged into every request
  headers:
    Accept: application/json
  timeoutMs: 5000       # optional, positive number
```

## environments/<name>.yaml

```yaml
variables:              # string → string only
  baseUrl: https://staging.example.com
  apiToken: "{{$env.STAGING_API_TOKEN}}"   # secrets: always $env, never literal
```

## *.request.yaml

```yaml
name: Create a post     # optional but always set it (used in reports/UI)
method: POST            # GET | POST | PUT | PATCH | DELETE | HEAD | OPTIONS
url: "{{baseUrl}}/posts"
headers:                # string → string; values must be quoted if not plain
  X-Trace: "abc"
query:                  # string → string; appended to the URL
  verbose: "1"          # ⚠ numbers/bools must be quoted — schema rejects non-strings
auth:                   # optional; prefer this over a manual Authorization header
  # one of:
  # { type: none }
  # { type: bearer, token: "{{authToken}}" }
  # { type: basic, username: "...", password: "{{$env.PASSWORD}}" }
  # { type: apikey, header: X-API-Key, value: "{{$env.API_KEY}}" }   # header defaults to X-API-Key
  type: bearer
  token: "{{authToken}}"
body:                   # optional
  type: json            # json | text | xml | csv | form
  content:              # json: any YAML structure; text/xml/csv: a string;
    title: Hello        # form: string → string map (sent urlencoded)
timeoutMs: 10000        # optional, positive; overrides collection default
tests:                  # optional list of assertions (see below)
  - status: 201
capture:                # optional; variable name → JSONPath into the response body
  postId: $.id          # available as {{postId}} in later requests of the same run
```

## Assertions

Each list item is exactly one of these shapes. **Strict**: any extra or
misspelled key fails validation.

```yaml
- status: 200                          # exact status code (number)

- header: content-type                 # case-insensitive header name
  equals: application/json             # equals and/or contains (at least one)
  contains: json

- jsonpath: $.items[0].name            # value in a JSON body
  equals: Widget                       # any YAML value
  contains: Wid                        # substring (string values)
  exists: true                         # just presence

- bodyContains: "some raw substring"   # raw body text

- responseTimeBelow: 2000              # milliseconds
```

## Variables

- `{{name}}` — resolved from the selected environment's `variables`, plus
  anything `capture`d by earlier requests in the same run. Unresolved
  variables fail loudly at send time (by design).
- `{{$env.NAME}}` — resolved from OS environment variables at run time.
  The only correct way to reference secrets.
- Interpolation works in `url`, header/query values, auth fields, and
  string body content.

## JSONPath subset (for `jsonpath:` assertions and `capture:`)

The practical subset only: dot access `$.a.b`, index `$[0]` / `$.items[0]`,
bracket keys `$["key with spaces"]`. No wildcards, filters, or recursive
descent — don't generate them.
