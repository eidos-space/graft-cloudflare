# Personal Graft Remote for Cloudflare

[简体中文](README.zh-CN.md)

A Graft Remote v1 server in your own Cloudflare account. One deployment belongs
to one person, with multiple repositories and devices sharing one access token.
No Eidos account or official Sync subscription is required.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/eidos-space/graft-cloudflare)

See [validation](docs/VALIDATION.md) for completed checks and the remaining
Cloudflare dashboard deployment acceptance steps.

## Deploy

You need a Cloudflare account with Workers and R2 enabled, and a GitHub or GitLab
account for the copy created by Cloudflare. R2 requires its own activation and
billing setup, even if your usage stays within its included free allowance.

1. Generate a random access token in your password manager, or run `pnpm token`
   from a local checkout. Use at least 32 characters; `pnpm token` generates
   256 bits of randomness.
2. Select **Deploy to Cloudflare**, connect your account, and choose the Worker
   and repository names.
3. Enter the token as the **GRAFT_REMOTE_TOKEN** secret. Keep it in your password
   manager: the same token will be used by your devices.
4. Deploy. Cloudflare provisions an R2 bucket and SQLite Durable Objects from
   `wrangler.jsonc`. No account-specific resource IDs or custom domain are needed.
5. Copy the resulting HTTPS `workers.dev` address and open `/healthz` to check
   the service. Use that same origin for management and repository URLs.

The token grants access to **every repository in this deployment**. This is a
personal server, not a user registration or shared tenant service.

Cloudflare's deploy flow is documented in
[Deploy to Cloudflare buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/).

## Local development and command-line deployment

Use Node.js 22 or newer and the pnpm version declared in `package.json`.

```sh
git clone https://github.com/eidos-space/graft-cloudflare.git
cd graft-cloudflare
pnpm install --frozen-lockfile
pnpm setup:local
```

`setup:local` creates a private `.dev.vars` file with a random development token
and preserves an existing file. Then run:

```sh
pnpm dev
```

Local Wrangler development uses local R2 and Durable Object storage. Secrets in
`.dev.vars` are ignored by Git and are not uploaded by deployment.

To deploy to your own Cloudflare account:

```sh
pnpm exec wrangler login
pnpm exec wrangler secret put GRAFT_REMOTE_TOKEN
pnpm deploy
```

Wrangler automatically provisions the R2 binding on first deployment. Keep the
same Worker identity and resource associations on subsequent updates. Changing
the Worker name can create a separate service; it does not migrate your data.

## Create and discover repositories

Set `GRAFT_ORIGIN` to your deployed HTTPS origin, and load `GRAFT_REMOTE_TOKEN`
from your password manager or shell environment. Never put it in a remote URL.

```sh
export GRAFT_ORIGIN='https://your-worker.your-subdomain.workers.dev'
```

Create an end-to-end encrypted repository:

```sh
curl --fail-with-body \
  --header "Authorization: Bearer $GRAFT_REMOTE_TOKEN" \
  --header 'Content-Type: application/json' \
  --request PUT \
  --data '{"display_name":"Personal notes"}' \
  "$GRAFT_ORIGIN/api/graft/repositories/notes"
```

Omitting `encryption` defaults to `encrypted-remote-v1`. The server fixes the
repository's encryption profile and UUID when it is created. Retrying the same
creation does not reset its identity or downgrade its encryption.

List repositories:

```sh
curl --fail-with-body \
  --header "Authorization: Bearer $GRAFT_REMOTE_TOKEN" \
  "$GRAFT_ORIGIN/api/graft/repositories"
```

Repository URLs have the form `https://your-host/personal/notes`. The fixed
`personal` path is part of the URL layout, not a tenant identifier. Repositories
must be created before protocol access; requesting an unknown repository never
silently creates an unencrypted one.

The access token and encryption password are separate. The token authorizes
server access; encryption and password handling belong to the client. The
server does not receive or recover the encryption password.

## Use a plain repository with the Graft CLI

Use this explicit profile only when you want a repository whose contents are
readable by your Cloudflare storage administrator:

```sh
curl --fail-with-body \
  --header "Authorization: Bearer $GRAFT_REMOTE_TOKEN" \
  --header 'Content-Type: application/json' \
  --request PUT \
  --data '{"encryption":"plain","display_name":"CLI example"}' \
  "$GRAFT_ORIGIN/api/graft/repositories/cli-example"
```

From an existing local Graft repository, use a new remote name:

```sh
graft remote add selfhost "$GRAFT_ORIGIN/personal/cli-example"
graft push selfhost main
```

Then download into a new directory:

```sh
mkdir downloaded-copy
cd downloaded-copy
graft clone "$GRAFT_ORIGIN/personal/cli-example" main
```

Use your branch name in place of `main` if it differs. Graft clones into the
current directory; its second argument is a branch, not a destination folder.

Graft reads the bearer token from `GRAFT_REMOTE_TOKEN`. Use `graft+http://` only
for loopback development. Deployed encrypted repositories require HTTPS.

Current released Eidos Lite clients still restrict cloud connections to the
official service. This server does not add a self-host settings page to Lite.
Use an encrypted-remote-capable Graft integration to connect; a plain CLI test
does not establish Lite encrypted-client compatibility.

## Storage, limits, and operations

Repository metadata, encryption identities, references, and publication state
live in SQLite Durable Objects. Immutable data lives in a private R2 bucket.
Cloudflare Workers, SQLite Durable Objects, and R2 each have their own limits
and included allowances. Free-plan eligibility does not guarantee a zero bill
or unlimited storage; request CPU and upload limits also apply.

- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [Operations and backup boundaries](docs/OPERATIONS.md)
- [Management API](docs/API.md)

The service has no official-account calls, subscription checks, per-user quotas,
automatic garbage collection, repository deletion API, or built-in coordinated
backup/export command. All repositories share the account's resources.

## Validate changes

```sh
pnpm check
pnpm test
pnpm dry-run
```

These commands do not deploy or require Cloudflare credentials. They verify the
generated binding types, TypeScript, local Workers runtime behavior, and Worker
bundle. Native-client and actual deployment results are recorded separately in
[VALIDATION.md](docs/VALIDATION.md).

With `pnpm dev` running, `pnpm smoke` checks a local server using `.dev.vars`.
It creates small smoke repositories. To target your own deployed server, set
`GRAFT_SMOKE_ORIGIN` and `GRAFT_REMOTE_TOKEN` explicitly.

`pnpm smoke:sdk` additionally exercises encrypted initialization, two independent
device sessions, and a SQLite/attachment round trip. Set `GRAFT_SDK_PATH` to an
E2EE-capable Graft Node SDK package, and `GRAFT_SDK_NATIVE_PATH` when using a
separate native build. The server itself needs neither SDK nor native build.

## License

MIT. The protocol, Hono, and Cloudflare storage adapters are supplied by the
published [`@eidos.space/graft-remote` packages](https://github.com/eidos-space/graft).
