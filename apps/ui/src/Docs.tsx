function Code({ children }: { children: string }) {
  return <pre className="docs-code">{children.trim()}</pre>;
}

export function Docs() {
  return (
    <div className="docs">
      <h1>Using quiver</h1>
      <p>
        Everything you see here is a plain file in your team&apos;s Git
        repository. When you save a request in this UI, you are editing a
        small YAML text file — the same file your teammates see in code
        review, and the same file the command line runs in CI. There is no
        cloud account and nothing to sync.
      </p>

      <h2>Creating a request</h2>
      <p>
        Click <strong>+ New</strong> at the top of the sidebar and give the
        request a path like <code>users/create-user</code>. Folders group
        related requests; they are created automatically. You get a template
        to fill in, and the request appears in the sidebar after your first
        save.
      </p>
      <p>
        A request works the way you&apos;d expect from other API clients: the
        method and URL sit in the bar at the top next to <strong>Send</strong>,
        and everything else lives in the tabs below it —{" "}
        <strong>Params</strong>, <strong>Headers</strong>, <strong>Auth</strong>,{" "}
        <strong>Body</strong>, <strong>Tests</strong>, and{" "}
        <strong>Capture</strong>. Click the request&apos;s name at the top to
        rename it. <kbd>⌘</kbd>+<kbd>Enter</kbd> sends, <kbd>⌘</kbd>+
        <kbd>S</kbd> saves.
      </p>
      <p>
        Every request also has a raw <strong>YAML</strong> view (the toggle at
        the right end of the tab strip) showing the actual file text, for
        anyone who prefers it or needs something the form doesn&apos;t expose.
        Both views edit the same file; switching or saving from Form view
        rewrites the file from its fields, so any comments or unusual
        formatting only survive while you stay in YAML view.
      </p>
      <p>
        Requests run in alphabetical order when you <strong>Run all</strong>,
        so use numeric prefixes when order matters:{" "}
        <code>01-login</code>, <code>02-create-order</code>.
      </p>

      <h2>Anatomy of a request</h2>
      <Code>{`
name: Create a user          # display name (optional)
method: POST                 # GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS
url: "{{baseUrl}}/users"     # {{variables}} come from the environment
headers:
  X-Trace-Id: "demo"
query:                       # appended as ?limit=10
  limit: "10"
auth:
  type: bearer               # none | bearer | basic | apikey
  token: "{{$env.API_TOKEN}}"
body:
  type: json                 # json | text | form
  content:
    email: "ada@example.com"
tests:
  - status: 201
capture:
  newUserId: $.id            # save a response value for later requests
`}</Code>
      <p>
        Only <code>method</code> and <code>url</code> are required — start
        small and add sections as you need them.
      </p>

      <h2>Variables and environments</h2>
      <p>
        Anything in double braces, like <code>{"{{baseUrl}}"}</code>, is a
        variable. Values come from the environment selected in the top bar —
        each environment is a file under <code>environments/</code>:
      </p>
      <Code>{`
# environments/staging.yaml
variables:
  baseUrl: https://staging.example.com
  apiToken: "{{$env.STAGING_API_TOKEN}}"
`}</Code>
      <p>
        The same collection runs against local, staging, or production just
        by switching environments — the requests never change.
      </p>
      <p>
        <strong>Secrets:</strong> <code>{"{{$env.NAME}}"}</code> reads from
        the operating system&apos;s environment variables on the machine
        running the request. Use it for tokens and passwords so they are
        never written into a file that lands in Git. If a variable can&apos;t
        be found, the request fails with a message naming exactly what is
        missing.
      </p>

      <h2>Tests (assertions)</h2>
      <p>
        Each entry under <code>tests:</code> is one check against the
        response. They run automatically on every Send and Run, and each one
        shows as a green ✓ or red ✗.
      </p>
      <table className="docs-table">
        <thead>
          <tr>
            <th>Check</th>
            <th>Example</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Status code</td>
            <td>
              <code>- status: 200</code>
            </td>
          </tr>
          <tr>
            <td>Response header</td>
            <td>
              <code>- header: content-type</code>
              <br />
              <code>&nbsp;&nbsp;contains: application/json</code>
            </td>
          </tr>
          <tr>
            <td>Value in a JSON body</td>
            <td>
              <code>- jsonpath: $.user.email</code>
              <br />
              <code>&nbsp;&nbsp;equals: ada@example.com</code>
            </td>
          </tr>
          <tr>
            <td>Field exists (or not)</td>
            <td>
              <code>- jsonpath: $.items[0].id</code>
              <br />
              <code>&nbsp;&nbsp;exists: true</code>
            </td>
          </tr>
          <tr>
            <td>Body text contains</td>
            <td>
              <code>- bodyContains: "success"</code>
            </td>
          </tr>
          <tr>
            <td>Response time</td>
            <td>
              <code>- responseTimeBelow: 2000</code> (milliseconds)
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        <code>jsonpath</code> paths start at <code>$</code> (the whole
        response): <code>$.user.name</code> digs into objects,{" "}
        <code>$.items[0]</code> picks the first array element. Header names
        are matched case-insensitively, and <code>equals</code> on a jsonpath
        compares numbers, strings, booleans, or whole arrays/objects.
      </p>

      <h2>Chaining requests with capture</h2>
      <p>
        <code>capture:</code> pulls values out of a response and makes them
        available as variables to every request that runs afterwards. The
        classic use is logging in once and reusing the token:
      </p>
      <Code>{`
# auth/01-login.request.yaml
name: Login
method: POST
url: "{{baseUrl}}/login"
body:
  type: json
  content:
    username: "{{$env.API_USERNAME}}"
    password: "{{$env.API_PASSWORD}}"
tests:
  - status: 200
capture:
  authToken: $.token

# auth/02-me.request.yaml — runs after login, {{authToken}} is now set
name: Who am I
method: GET
url: "{{baseUrl}}/me"
auth:
  type: bearer
  token: "{{authToken}}"
tests:
  - status: 200
`}</Code>
      <p>
        Captured values appear as small chips in the response pane after a
        Send, so you can see exactly what was extracted.
      </p>

      <h2>Sending and running</h2>
      <p>
        <strong>Send</strong> runs the open request against the selected
        environment (saving it first if you have unsaved edits).{" "}
        <strong>▶ Run all</strong> runs every request in the collection in
        order, streaming results into a panel on the right as each one
        finishes — captures flow between requests exactly as they do in CI.
      </p>
      <p>
        The response appears below the request. Drag the divider between them
        to resize (double-click it to reset), or use the layout button next
        to the file path to put the response side-by-side with the request
        instead.
      </p>
      <p>
        The command line runs the very same files, which is how these tests
        run in pipelines:
      </p>
      <Code>{`
quiver run path/to/collection --env staging
`}</Code>

      <h2>Saving and sharing</h2>
      <p>
        Save validates your YAML before writing — a typo like{" "}
        <code>method: GETT</code> is rejected with an explanation, and the
        file on disk is untouched until the content is valid. Saved changes
        are ordinary file edits: commit them, open a pull request, and your
        teammates review API changes like any other code.
      </p>
    </div>
  );
}
