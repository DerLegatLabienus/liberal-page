# Database access for an unattended cloud agent: is SQL over HTTPS normal?

Research note, 2026-10-07. Read-only investigation: no database, routine, cloud environment or
GitHub setting was touched, and no repo file other than this one was changed. Sources are official
docs and first-party repos, cited inline, all fetched on 2026-10-07. Where a statement is my own
inference rather than something a doc says, it is marked **(inference)**.

The developer's question: *"I assume I'm not the only one using routines for projects with
databases. How do other projects handle it? Do they also allow this kind of web wrapper, querying
over HTTPS, to read data?"*

## Short answer

Querying a database over HTTPS is an established, vendor-supported pattern, not an odd trick:
Neon, Supabase, PlanetScale, AWS Aurora, Cloudflare D1 and Turso all publish one, and they give the
same reason this project hit, namely that some runtimes cannot open a raw database connection.
What Anthropic's docs describe for cloud sessions is three things: a local Postgres started inside
the session, MCP connectors, and HTTPS calls to allowlisted hosts with an "API credential" the
session cannot read. They never mention reaching a remote database on port 5432, so `loop:sql` fits
the third path. The design that actually protects the data (a role made with SQL, limited to 25
views with no personal columns) follows Neon's, Postgres's and OWASP's guidance, and it is
stricter than the Neon MCP connector, which Neon itself says not to point at production and which
cannot be limited to those views. Two things are off the sanctioned path and worth fixing: the
connection string sits in an environment variable, which Anthropic's docs warn against, and the
wrapper speaks Neon's HTTP protocol by hand, using a header that only appears in the driver's
source code, not in Neon's docs. **Recommendation: keep the approach, move the secret to an API
credential if that works in a test, and treat the hand-built request as the one fragile part.**

## What the project built (read from the repo, not changed)

`scripts/loop/sql.ts` (committed as `834b34d` on 2026-10-07) sends one statement as a hand-built
`fetch` `POST` to `https://api.<rest of the Neon host>/sql` with the header
`Neon-Connection-String`, read from `LOOP_DATABASE_URL`. It does not use the
`@neondatabase/serverless` package. It refuses hosts outside `*.neon.tech`, refuses redirects, caps
rows and output, and has a "one read statement" check that its own comments describe as a courtesy,
not a security boundary. The boundary is the Postgres role `loop_reader`, which can read the
`loop_read` views and nothing else (`scripts/loop-read-views.sql`, `CLAUDE.md`).

---

## 1. What Anthropic documents for databases in cloud sessions and routines

**The network path is an HTTP/HTTPS proxy with a domain allowlist.**

- "Cloud sessions in Anthropic-hosted environments run behind an HTTP/HTTPS network proxy for
  security and abuse prevention purposes ... All outbound internet traffic from an Anthropic-hosted
  session passes through this proxy."
  https://code.claude.com/docs/en/cloud-environments#security-proxy
- Four access levels: None, Trusted ("Allowlisted domains only: package registries, GitHub, cloud
  SDKs"), Full ("Any domain"), Custom ("Your own allowlist").
  https://code.claude.com/docs/en/cloud-environments#access-levels
- For routines: "Requests on that path to hosts outside the allowlist fail with `403` and
  `x-deny-reason: host_not_allowed`."
  https://code.claude.com/docs/en/routines#environments-and-network-access

**The docs are silent on non-HTTP protocols and TCP ports.** None of the four pages read
(cloud-environments, claude-code-on-the-web, routines, self-hosted-environments) says whether a
Postgres connection on port 5432, or any non-HTTP protocol, can leave an Anthropic-hosted session,
at any access level. The only hint is the wording "HTTP/HTTPS network proxy" and the fact that the
allowlist is a list of domains. The statement "TCP 5432 times out" is this project's own test
result from 2026-10-05/07, not something the docs say. Whether **Full** access would let a
Postgres connection through is not documented and was not tested.

**What the docs do describe for databases is a local one, inside the session.**

- "PostgreSQL and Redis are pre-installed but not running by default. Ask Claude to start whichever
  you need", with the command `service postgresql start`. "Docker is available for running
  containerized services."
  https://code.claude.com/docs/en/cloud-environments#start-services
- The environment-variable example on the same page is `DATABASE_URL=postgres://localhost:5432/myapp`,
  that is, a database on the session's own machine.
  https://code.claude.com/docs/en/cloud-environments#set-environment-variables
- A database started by a setup script does not survive the environment cache: "A database the
  script started, a `docker compose up` stack, or any other background process doesn't; start those
  per session".
  https://code.claude.com/docs/en/cloud-environments#environment-caching

There is no sentence anywhere in these pages recommending a way to read a **remote** database. The
three documented ways for a session to reach an outside system are below; a remote database has to
come in through one of them **(inference from the docs' silence)**.

**Way 1: HTTPS to an allowlisted host, with an API credential.**

- "An API credential is an API key or token you store on a cloud environment so Claude can call
  that API from any session in the environment without seeing the key. Anthropic's agent proxy adds
  the key to requests for the hosts you list, after each request leaves the session's VM. The key
  never reaches Claude, the commands it runs, or the session's environment variables."
  https://code.claude.com/docs/en/cloud-environments#add-api-credentials
- Environment variables are the opposite: "Anyone who uses the environment can read its environment
  variables and setup script. The dialog's note under **Environment variables** says so and warns
  against putting secrets there. On Pro and Max plans, store a key the agent proxy can attach as an
  API credential instead."
  https://code.claude.com/docs/en/cloud-environments#what-carries-over-from-your-setup
- Limits: "API credentials are available on Pro and Max plans. They aren't available on Team or
  Enterprise plans yet". A self-hosted environment does not have them. The API must accept
  connections from the internet "because requests leave from Anthropic's network". (same section)
- The header is configurable: "For a header like `X-Api-Key` that takes the bare value, change the
  name and clear the prefix". So a header named `Neon-Connection-String` with no prefix fits the
  form **(inference; the docs give no database example)**.
- Hosts listed on a credential are reachable "even when the environment's network access level
  wouldn't otherwise allow them".
  https://code.claude.com/docs/en/cloud-environments#which-requests-get-the-credential
- A credential applies "in every session that runs in the environment, whoever started it, until
  you delete it", and cannot be edited, only deleted and re-added. (same section)

**Way 2: MCP connectors.**

- "Routines can use your connected MCP connectors to read from and write to external services
  during each run." https://code.claude.com/docs/en/routines#connectors
- Their traffic does not use the session's network at all: "MCP connectors you enable on a session
  or routine work without adding their hosts to **Allowed domains**, because connector traffic
  travels through Anthropic's servers rather than the session's network."
  https://code.claude.com/docs/en/cloud-environments#network-access
- Two defaults matter for an unattended run. "When you create a routine, all of your currently
  connected connectors are included by default. Remove any that aren't needed". And routines run
  "without stopping for approval": the session "calls any connectors you include".
  https://code.claude.com/docs/en/routines#connectors and https://code.claude.com/docs/en/routines
- A repo's committed `.mcp.json` servers also load in a cloud session with one repository.
  https://code.claude.com/docs/en/cloud-environments#what-carries-over-from-your-setup

**Way 3: self-hosted environments.** Sessions run on the customer's own machines, so the network
rules are the customer's: "sessions run inside your network and can reach internal services,
databases, and registries without exposing them to the public internet".
https://code.claude.com/docs/en/self-hosted-environments This is the one place the docs name
remote databases as reachable. It means running and securing your own runners, and it has no API
credentials feature. It is aimed at organizations, not a solo developer **(inference)**.

---

## 2. The MCP route

### Neon

- There is an official hosted server at `https://mcp.neon.tech/mcp`, and "The Neon MCP server is an
  official Claude connector", added from claude.ai's connector directory and authorized with OAuth.
  https://neon.com/docs/ai/neon-mcp-server#claude-connector
- It can be narrowed: `?readonly=true` ("restrict the server to read operations"),
  `?projectId=<id>` ("Scope all operations to a single project") and `?category=...` to publish
  only some tool groups. With OAuth the same choices appear on the consent page.
  https://neon.com/docs/ai/neon-mcp-server#access-control and
  https://github.com/neondatabase/mcp-server-neon#scopes-and-read-only-mode
- In read-only mode "the `run_sql` tool remains available only for read-only queries", and
  `get_connection_string` is withheld because "the connection string carries a privileged role
  password". https://github.com/neondatabase/mcp-server-neon#scopes-and-read-only-mode
- Without those limits it exposes the whole management surface: creating and deleting projects,
  branches, databases and roles, running migrations, and `run_sql`, which "Supports both read and
  write operations". https://github.com/neondatabase/mcp-server-neon#supported-tools
- **Neon's own guidance rules it out for this use.** "We recommend MCP for **development and
  testing only**, not production environments. Use MCP only for local development or IDE-based
  workflows. Never connect MCP agents to production databases. Avoid exposing production or PII
  data; use anonymized data only. Always review and authorize LLM-requested actions before
  execution." https://neon.com/docs/ai/neon-mcp-server#mcp-security-guidance
- **It cannot be limited to the 25 views.** The connector signs in as the Neon *account*, not as a
  database role. The `run_sql` tool takes a project, branch, database and SQL text; it has no
  parameter for choosing a Postgres role (tool definition as listed by the Neon MCP server in the
  developer's local Claude Code session, read 2026-10-07; not confirmed to be the same build as
  the claude.ai directory connector). The docs do not say which role it runs as. If it is the project's owner role, that
  role is in `neon_superuser`, which includes `BYPASSRLS` (section 5), so "read-only" would still
  mean "can read every table, including emails and tokens" **(inference; the role is not
  documented)**.

### Other hosts, only what their own docs say

- **Supabase.** `read_only=true` makes the server "Execute all queries as a read-only Postgres
  user", and `project_ref=<id>` scopes it to one project. "Production projects can contain
  sensitive data. Before connecting one, scope the server to that project, enable read-only mode,
  restrict the available feature groups, and review the security risks."
  https://supabase.com/docs/guides/ai-tools/mcp
- **PlanetScale.** OAuth scopes choose "no access, read-only access, or full access to databases at
  the organization or per-database level". Read queries go to a replica when one exists, each query
  uses "short-lived, ephemeral credentials", and for Postgres the read role has `pg_read_all_data`
  and "does not bypass row-level security". "We advise caution when giving LLMs write access to any
  production database." https://planetscale.com/docs/mcp-server
- **Render.** The server can "Query your databases" and "supports potentially destructive
  operations, including modifying a service's environment variables and triggering deploys".
  https://render.com/docs/mcp-server I did not find a read-only switch for the whole server on that
  page. Not relevant here anyway: this project's database is on Neon, not Render.
- **Prisma.** A remote server at `https://mcp.prisma.io/mcp` that "can manage databases, run SQL,
  restore automated backups"; "Tools that change or delete resources can cause data loss or
  interrupt live traffic." https://www.prisma.io/docs/ai/tools/mcp-server I did not find a
  read-only mode on that page.

Common thread: every vendor's MCP server signs in with account-level rights and then offers
switches to narrow them. None of them documents handing the agent a custom, column-limited database
role, which is what this project did **(inference from the four pages)**.

---

## 3. SQL over HTTPS as a first-class feature

### Neon: two sanctioned interfaces, and where the project's wrapper sits

- **The serverless driver's HTTP mode is documented and recommended.** The driver "allows you to
  query data from serverless and edge environments over **HTTP** or **WebSockets** in place of
  TCP", and "Use the driver over **HTTP** by default. The `neon()` function sends each query as an
  HTTP fetch request". Auth is the normal Postgres connection string (role and password). Request
  and response are capped at 64 MB. https://neon.com/docs/serverless/serverless-driver
- **The endpoint address is documented; the request format is not.** The driver's config reference
  documents `fetchEndpoint` as the "server endpoint to be sent queries via http fetch", and the
  source shows the default is the host with its first label replaced by `api.` plus `/sql`.
  https://github.com/neondatabase/serverless/blob/main/CONFIG.md and
  https://github.com/neondatabase/serverless/blob/main/src/shims/net/index.ts
  The headers the project sends (`Neon-Connection-String`) and could send (`Neon-Batch-Read-Only`)
  appear only in the driver's source, `src/http/index.ts`. I found no Neon docs page that describes
  the raw request. https://github.com/neondatabase/serverless/blob/main/src/http/index.ts
  So: the **transport** is first-class, the **hand-written request** is an undocumented detail of
  the driver that Neon could change without notice **(inference)**.
- **The driver has a documented read-only switch.** `readOnly` is a transaction option, and
  "Defaults for the transaction-related keys can also be set as options to the `neon` function".
  https://neon.com/docs/serverless/serverless-driver-configuration and CONFIG.md above. The
  project's wrapper does not set it; the role's grants already refuse writes.
- **The Data API is the other sanctioned interface.** "Neon Data API is a PostgREST-compatible HTTP
  query interface for Neon Postgres", built for browsers and edge runtimes.
  https://neon.com/docs/data-api/overview It authenticates with JWTs and "has no permission layer
  of its own. Every request is authorized entirely by your PostgreSQL `GRANT` statements and
  Row-Level Security (RLS) policies, so a missing or misconfigured policy can expose a table to
  anyone with the endpoint URL." It is "enabled per branch for a single database and does not
  support projects with IP Allow or Private Networking configured".
  https://neon.com/docs/data-api/get-started
- Neon's own decision guide maps each to a use: TCP drivers for long-lived servers, the serverless
  driver over HTTP for Workers/Netlify/Deno, the Data API for browser apps.
  https://neon.com/docs/connect/choose-connection

### The same idea elsewhere

| Vendor | First-party HTTP query interface | Source |
|---|---|---|
| Supabase | Auto-generated REST API from the schema, "using PostgREST, a thin API layer on top of Postgres", secured with API keys and row-level security | https://supabase.com/docs/guides/api |
| PlanetScale | Serverless driver: "Some serverless and edge function hosts do not permit arbitrary outbound TCP connections ... executing queries over an HTTP connection, which is generally not blocked by cloud providers" | https://planetscale.com/docs/vitess/tutorials/planetscale-serverless-driver |
| AWS Aurora | RDS Data API: "a web-services interface to your Aurora DB cluster" that "doesn't require a persistent connection"; credentials stay in AWS Secrets Manager, so "Users don't need to pass credentials with calls" | https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api.html |
| Cloudflare D1 | "Worker and HTTP API access"; a REST endpoint takes `{ sql, params }` with an API token | https://developers.cloudflare.com/d1/ and https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/ |
| Cloudflare Hyperdrive | The opposite approach: keeps ordinary TCP drivers working from Workers by pooling connections to "any Postgres or MySQL database, including those hosted on ... Neon and PlanetScale" | https://developers.cloudflare.com/hyperdrive/ |
| Turso / libSQL | "SQL over HTTP" reference: a pipeline endpoint with a bearer token | https://docs.turso.tech/sdk/http/reference |
| Prisma Accelerate | "a managed connection pool and global cache", aimed at "serverless and edge environments, where connection exhaustion is a real failure mode". The page read does not describe the wire protocol | https://www.prisma.io/docs/accelerate |
| Xata | Not confirmed. The current docs overview describes Postgres branches and clones and does not mention an HTTP query API | https://xata.io/docs/overview |
| Google AlloyDB / Cloud SQL | Not confirmed. The URL I tried for an AlloyDB data API returned 404; I did not find a first-party page | (none) |

So yes: "send SQL in an HTTPS request" is an industry pattern with at least six first-party
implementations. The stated reasons are consistent: runtimes that cannot open raw TCP sockets
(browsers, edge functions), the cost of setting up and pooling connections in short-lived code, and
keeping database credentials out of the caller (AWS). An agent sandbox behind a web-only proxy is
the same constraint in a new place **(inference; no vendor page read here names agent sandboxes as
the motive)**.

---

## 4. How comparable agent platforms handle it

**OpenAI Codex cloud.** The closest match to Anthropic's design, down to the wording:
"Environments run behind an HTTP/HTTPS network proxy for security and abuse prevention purposes.
All outbound internet traffic passes through this proxy." Agent internet access is off by default
and can be turned on with "a domain allowlist and allowed HTTP methods"; "For extra protection,
restrict network requests to `GET`, `HEAD`, and `OPTIONS`." Secrets are stricter than Anthropic's:
"They are only available to setup scripts. For security reasons, secrets are removed before the
agent phase starts", while plain environment variables last the whole task. Named risks: "Prompt
injection from untrusted web content" and "Code or secret exfiltration". Databases and non-HTTP
protocols: not documented. The internet-access page is now titled "Codex Cloud (Legacy)".
https://developers.openai.com/codex/cloud/internet-access and
https://developers.openai.com/codex/cloud/environments

**GitHub Copilot cloud agent.** "By default, Copilot's access to the internet is limited by a
firewall", with a recommended allowlist plus custom entries. GitHub states its limits: it "only
applies to processes started by the agent via its Bash tool. It does not apply directly to Model
Context Protocol (MCP) server processes or processes started in configured Copilot setup steps",
and "should not be considered a comprehensive security solution". The route it offers for outside
systems is MCP, with secrets named `COPILOT_MCP_*`, and this warning: "Copilot will be able to use
the tools provided by the server autonomously, and will not ask for your approval ... We strongly
recommend that you allowlist specific read-only tools". Databases: not documented by name.
https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-the-firewall
and https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/configure-mcp-servers

**Cursor cloud agents.** The most open of the group: "The agent has internet access by default",
with optional egress modes (allow all, default + allowlist, allowlist only). It is the only one
whose docs address databases directly: MCP servers give "access to external tools and data sources
like databases", and "For TCP targets such as private databases, use a tunnel client that exposes a
local TCP listener in the agent environment" (Tailscale or Cloudflare Tunnel). Secrets come in
three kinds: environment variables "visible to the cloud agent", runtime secrets redacted from the
transcript, and build secrets never given to the running agent; "prefer short-lived OIDC tokens
over long-lived keys". It also names the risk: "attackers could execute prompt injection attacks,
tricking the agent to upload code to malicious websites."
https://cursor.com/docs/cloud-agent and https://cursor.com/docs/cloud-agent/security-network

**Devin.** Works by giving the agent credentials and network reach rather than by walling it off.
Secrets are stored encrypted and made usable in sessions; one of the docs' own example notes for a
secret reads "Used for our AWS RDS Database in us-west-2". "Devin can connect to a VPN from inside
its workspace, so sessions can reach internal services such as package registries, databases, and
internal Git hosts." An outbound allowlist or default-deny firewall: not found in the pages read.
https://docs.devin.ai/product-guides/secrets and https://docs.devin.ai/onboard-devin/vpn

**Google Jules.** Code "is executed in a secure, cloud-based virtual machine (VM) with internet
access", and the only security advice is "Don't commit secrets ... to your repo". The environment
page covers setup scripts and lists Docker as pre-installed. A secrets store, a domain allowlist
and database access: not documented in the pages read.
https://jules.google/docs/faq/ and https://jules.google/docs/environment/

Pattern across the five: the two platforms with a web proxy (Anthropic, Codex) say nothing about
remote databases; the ones with open networks (Cursor, Devin, Jules) leave it to credentials,
tunnels or MCP. Nobody documents "connect the agent to production Postgres" as a recommended
default, and the two that discuss risk both name prompt injection leading to data leaving the
sandbox **(inference from the pages above)**.

---

## 5. Least-privilege guidance that bears on the decision

- **OWASP, LLM06:2025 Excessive Agency.** The root causes are "excessive functionality; excessive
  permissions; excessive autonomy". Its own example of excessive permissions: "an extension
  intended to read data connects to a database server using an identity that not only has SELECT
  permissions, but also UPDATE, INSERT and DELETE permissions." Its example of excessive
  functionality: a tool chosen to read documents that "also includes the ability to modify and
  delete documents". Mitigations start with "Limit the extensions that LLM agents are allowed to
  call to only the minimum necessary" and "Limit the functions that are implemented in LLM
  extensions to the minimum necessary."
  https://genai.owasp.org/llmrisk/llm062025-excessive-agency/
  A one-purpose read wrapper with a SELECT-only role is the textbook answer to this; a general
  database management connector is the textbook example of the problem **(inference)**.
- **Neon: how the role is made decides what it can do.** "Roles created in the Neon Console, CLI,
  or API ... are granted membership in the `neon_superuser` role", which includes `CREATEDB`,
  `CREATEROLE` and `BYPASSRLS`. "If you require roles with limited privileges, such as a read-only
  role, you can create those roles from an SQL client." https://neon.com/docs/manage/roles
  Roles made with SQL "are not assigned the neon_superuser role. They must be selectively granted
  permissions for each database object." https://neon.com/docs/manage/database-access
  This confirms the choice recorded in `CLAUDE.md` to create `loop_reader` with plain SQL.
- **Postgres: why a view can show columns the role cannot read directly.** "By default, access to
  the underlying base relations referenced in the view is determined by the permissions of the view
  owner." https://www.postgresql.org/docs/current/sql-createview.html The rules chapter gives the
  same shape as an example: a view over a private table, with `GRANT SELECT` on the view only, so
  the grantee can read the view and "Nobody except that user (and the database superusers) can
  access the ... table". https://www.postgresql.org/docs/current/rules-privileges.html
  Two options to know about: `security_barrier` "should be used if the view is intended to provide
  row-level security", meaning views that hide **rows** with a `WHERE` clause. A view that only
  leaves out columns does not need it **(inference from that sentence)**. In
  `scripts/loop-read-views.sql` the two views that filter rows (`letters` and `letter_channels`,
  published letters only) are both declared `WITH (security_barrier)`, which matches this advice
  (checked by searching the file for `WHERE`; the file was not otherwise reviewed).
  `security_invoker` would
  check the *caller's* rights on the base tables instead of the owner's; turning it on would break
  this design, since `loop_reader` has no rights on the tables. (same CREATE VIEW page)
- **Neon read replicas and branches protect against writes and load, not against reading.** A read
  replica is a "read-only compute" over "the same data as your primary", offered for "Granting
  read-only access to users or applications that don't require write permissions".
  https://neon.com/docs/introduction/read-replicas A child branch of production copies schema and
  data. So a replica or a branch holds the same real emails and tokens as production. A
  schema-only branch holds none, and then there is nothing for the loop to measure. Protected
  branches (new role passwords on child branches) are a paid-plan feature.
  https://neon.com/docs/guides/protected-branches

---

## 6. Verdict for this project

**The built approach is a normal pattern with one non-standard piece and one mismatch with
Anthropic's guidance.**

- Normal: querying over HTTPS because the runtime has no TCP (section 3); a SQL-created role with
  SELECT on named views only (section 5); a single-purpose tool instead of a general one (OWASP).
- Non-standard: the request is written by hand against a header format that only the driver's
  source documents.
- Mismatch: the connection string is in an environment variable, which the session and any command
  it runs can read. Anthropic's docs warn against exactly that and point to API credentials.

How the alternatives compare:

| Option | What it would give | Why it is better or worse here |
|---|---|---|
| **Current: read-only role + allowlisted views + HTTPS wrapper** | The agent sees 25 views, no personal data, cannot write | The limit is enforced by the database itself. Weak points: secret readable in the session; hand-built protocol |
| **(a) Neon MCP connector, read-only, project-scoped** | No wrapper code, no allowlist entry, no secret in the session (OAuth) | Worse on the point that matters: it cannot be limited to the views, so read-only still means every table, personal data included. Neon says never to connect MCP agents to production and to review each action, and a routine runs with no review. It also adds schema and diagnostic tools the loop does not need |
| **(b) A Neon branch or read replica as the target** | Protection for production against writes and heavy queries | Does not address privacy: same rows. The role already cannot write. A branch also goes stale and counts against the Free plan's branch and compute limits (see the 2026-10-05 note). Worth it only if the loop's queries ever get heavy enough to slow production |
| **(c) Neon Data API with its own auth** | A documented HTTP interface with PostgREST filters instead of free SQL | Needs a JWT provider and RLS policies, and publishes an endpoint whose safety depends wholly on grants being right. More setup and more public surface than one role with one password, for the same data. Aggregates such as counts and sizes are awkward through a REST layer **(inference)** |
| **(d) No database access** | Nothing to leak, nothing to maintain | The safest option, and the one the comparable platforms default to. Costs the loop its view of real data shape and size, which is why `loop_read` was built. The local Postgres that Anthropic documents covers schema and tests, with no real rows |

**Recommendation for a solo developer: keep the current approach, with two changes.**

1. **Move the connection string out of the environment variable and into an API credential**, if a
   test shows it works. That is the route Anthropic documents for a key the agent must use but
   should not read. It needs a small change to the wrapper: today the host is derived from the
   secret, and with an API credential the session never has the secret, so the host has to be
   given separately (it is not sensitive). Until this is tested, the environment variable is
   acceptable **only because** the role behind it can read 25 views with no personal data: if the
   string leaks, the damage is that same non-personal data, and the fix is resetting one password.
2. **Decide what to do about the hand-built request.** Either accept it and say so (a failure
   would be loud: `loop:sql` exits non-zero and the loop carries on without data), or switch the
   wrapper to `@neondatabase/serverless`, which is the interface Neon documents and which also has
   a `readOnly` option. Note the trade: with the driver, the connection string must be in the
   session, so the driver and the API-credential route may not combine. If only one is possible,
   prefer the API credential, since a readable secret is the larger of the two concerns
   **(inference)**.

One standing precaution, whichever way this goes: if the Neon connector is ever added to the
developer's claude.ai account, remove it from the routine. Routines include every connected
connector by default, connector traffic ignores the domain allowlist, and that connector would
give the unattended loop account-level access to the production project. As far as the repo shows,
the routine does not have it now. Checked 2026-10-07: there is no `.mcp.json` in the repo (a
committed one would load in a single-repo cloud session). `.claude/settings.json` enables a Neon
*plugin* (`neon-postgres@neon`), and the docs say "A cloud session doesn't install the plugins a
repository turns on under `enabledPlugins`". Servers added on the developer's machine "do not
appear in the connectors list". What is connected on the claude.ai account itself was not checked.
https://code.claude.com/docs/en/routines#connectors and
https://code.claude.com/docs/en/cloud-environments#what-carries-over-from-your-setup

**What would change this recommendation:**

- If the loop rarely uses the data, drop to (d). Less to maintain beats a well-guarded feature
  nobody needs.
- If the views ever have to include personal data, stop and redesign: a readable secret and an
  unattended agent that also reads untrusted web content is the prompt-injection case the Codex and
  Cursor docs describe. An anonymized copy would be the direction to look, not a wider view.
- If Neon documents the raw `/sql` request, or ships a database-role-scoped read-only MCP mode, the
  "non-standard piece" disappears or (a) becomes worth another look.
- If the developer moves to a Team or Enterprise plan, API credentials are not available there, and
  the secret stays in an environment variable.
- If Anthropic documents direct database connections from cloud sessions, the wrapper could become
  a plain `pg` call. Nothing in the docs today suggests this.

---

## Not verified

Each of these is absent from the docs, contradictory, or simply not tried. Nothing was tested for
this note.

1. Whether an Anthropic-hosted session can open a Postgres connection on port 5432 at **Full**
   network access. The docs do not mention ports or non-HTTP protocols; the timeout is this
   project's own observation, at an access level this note did not confirm.
2. Whether an API credential works with Neon's `/sql` endpoint: that the proxy accepts a header
   named `Neon-Connection-String` with an empty prefix, a value containing `:`, `/`, `@` and `?`,
   and what happens when the request already carries that header (replace, duplicate or reject).
   The docs give only `Authorization` and `X-Api-Key` examples.
3. Which Claude plan this account is on. API credentials need Pro or Max.
4. Which Postgres role the Neon MCP server's `run_sql` uses, and whether read-only mode is enforced
   by a read-only transaction, a separate role, or statement filtering. The README says only that
   `run_sql` "remains available only for read-only queries". The claim that it can read every table
   is an inference from the missing role parameter.
5. Whether Neon's claude.ai directory connector accepts the `readonly`/`projectId` URL parameters,
   or only the choices on the OAuth consent page. The docs describe both mechanisms but not which
   one the directory entry uses.
6. Whether Neon treats the raw `/sql` request format as stable. It is used by their own published
   driver, which suggests it will not change casually, but no page promises it.
7. Whether the `Neon-Batch-Read-Only` header has any effect on a single (non-batch) query. Seen in
   source only; behaviour not read through.
8. Which role owns the `loop_read` views in production, and so whose rights they run with. The
   SQL file does not set an owner; it would be whoever ran it. The live database was not queried.
   Also not checked: which connectors are connected on the developer's claude.ai account and
   attached to the routine.
9. Render's and Prisma's MCP servers: I did not find a server-wide read-only mode on the pages
   read. That is "not found", not "does not exist".
10. Xata and Google AlloyDB / Cloud SQL HTTP query interfaces: not confirmed either way.
11. Prisma Accelerate's wire protocol (the page read describes pooling and caching, not HTTP).
12. Devin's and Jules's outbound network restrictions and Jules's handling of secrets: not found in
    the pages read; their docs sites were not searched exhaustively.
13. The quotes from HTML pages (OpenAI, GitHub, Cursor, Supabase, PlanetScale, AWS, Cloudflare,
    Turso, Prisma, PostgreSQL, OWASP) were extracted from page text by script, sentence by
    sentence. They are verbatim as extracted, but the section anchors were not all checked, and
    several of these URLs redirect (OpenAI's to `learn.chatgpt.com`, GitHub's to the paths cited).
14. How other real projects using routines handle databases. The developer's question was "how do
    other projects handle it"; no primary source answers that. There is no official survey, and
    blog and forum posts were deliberately not used. This note answers what the platforms and
    vendors document, not what users actually do.
