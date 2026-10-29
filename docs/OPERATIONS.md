# Operations

[简体中文](OPERATIONS.zh-CN.md)

## Access and rotation

`GRAFT_REMOTE_TOKEN` is the single deployment-wide bearer secret. Every device
with this token can read and write every repository and create repositories.
There are no independent users, device grants, or per-repository permissions.

Use a password manager to retain a high-entropy token. Never add it to a remote
URL, Wrangler `vars`, a shell command committed to Git, an issue, or a support
log. The Worker fails closed when the configured token is absent or unsuitable.

To rotate the token, generate a replacement and update the secret:

```sh
pnpm token
pnpm exec wrangler secret put GRAFT_REMOTE_TOKEN
```

Update all connected devices. Rotation does not modify repository UUIDs,
encrypted objects, or client encryption passwords. In-flight requests may
complete; do not treat rotation as deletion of stored data.

## Upgrades

Keep the same Worker name, R2 association, and Durable Object namespaces.
Review the diff, install the committed lockfile, and run `pnpm check`,
`pnpm test`, and `pnpm dry-run` before deployment. Keep a known compatible
Worker version available for rollback. A rollback must still understand all
stored repository profiles and metadata schemas.

Pin protocol/storage package versions together. A successfully bundled Worker
does not prove compatibility with a particular released native client. Verify
encrypted provisioning, push, clone/unlock, and pull with the clients you use.

## Backups and recovery

A synchronized remote is another writable copy, not an independent backup.
Keep a verified local clone and an independent backup of important data.

A complete server backup must preserve a consistent set of:

- repository directory records and stable internal IDs;
- repository encryption profiles and UUIDs;
- exact mutable HEAD/reference bytes;
- immutable R2 objects, including retained encrypted staging-backed objects;
- published-object visibility mappings and any retained upload state needed by
  the storage adapter.

Copying only the R2 bucket does not produce a restorable encrypted repository.
Restoring only Durable Object metadata can leave references to missing bytes.
Do not delete R2 objects by age or by an `encrypted-staging` prefix: published
encrypted data can still use keys under that prefix.

This version does not supply a coordinated server export/restore command.
Cloudflare's per-resource recovery features do not by themselves establish a
consistent cross-resource backup. Until you have a verified server recovery
procedure, retain a full local repository, its encryption credentials, and
independent backups. Test restoration into a separate deployment or empty
local directory before relying on a backup.

## Storage reclamation and deletion

Failed conditional updates can leave unreachable immutable bytes. There is no
automatic garbage collector or repository deletion endpoint in this version.
Do not reclaim space by guessing reachability from object names or timestamps.
Do not delete metadata or rename namespaces to reset a repository: its published
identity and encryption state are part of its storage contract.

For planned retirement, first verify independent local copies and backups,
disconnect clients, and then use Cloudflare's resource administration with a
deliberate retention plan. Removing a Worker does not establish that all its
R2 and Durable Object data has been erased.

## Resource limits

Workers Free is eligible because all Durable Objects use SQLite storage. The
deployment also needs R2 activation. Each product has separate quotas, costs,
and failure behavior. Monitor requests, CPU errors, R2 usage, and SQL storage.
One client operation can produce several Worker and Durable Object requests.

Large files may require multiple protocol uploads. Streaming controls Worker
memory use but does not bypass Cloudflare's per-request body limits. Test your
actual client and file sizes rather than interpreting a storage allowance as
the maximum supported file size.

References:

- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
