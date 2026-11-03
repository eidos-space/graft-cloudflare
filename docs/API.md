# Management API

[简体中文](API.zh-CN.md)

Use the same HTTPS origin as the protocol endpoints. Authenticated requests
carry `Authorization: Bearer <access-key>`. Never send an encryption
password to these endpoints.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/` | Public service information |
| GET | `/healthz` | Public configuration health; 503 when the token is not configured |
| GET, POST | `/setup` | One-time setup page and access-key claim |
| GET | `/.well-known/graft` | Public service discovery |
| GET | `/api/graft/repositories` | List the owner's repositories |
| PUT | `/api/graft/repositories/:name` | Idempotent explicit repository provisioning |
| PATCH | `/api/graft/repositories/:name` | Change the display name only |
| DELETE | `/api/graft/repositories/:name` | Start or retry remote deletion |
| GET | `/api/graft/repositories/:name/status` | Read deletion status |

All `/api/graft/` endpoints require the shared token. The fixed `personal`
protocol namespace does not represent an account or tenant.

## Encrypted object verification

Encrypted repositories advertise `e2ee-object-proof-v1` when supported. The shared
Graft protocol handler validates a fresh 32-byte challenge and constructs the
repository-bound prefix for `POST /personal/:name/e2ee/object-proof/:opaqueKey`.
The opaque key uses literal slash-separated segments; percent-encoded paths are
rejected. The backend streams one persisted R2 snapshot and returns the SHA-256
of the prefix and actual ciphertext, with its measured byte count. It does not
use upload-time digests or cache challenge responses.

Each repository admits at most two concurrent proofs; excess requests receive
429. Reads stop on caller cancellation or after 60 seconds, returning an error
rather than a partial proof. Deletion waits for admitted proofs to finish and
rejects new ones. Older clients can continue using ordinary authenticated reads.
This check verifies current bytes; it is not a backup or a future durability guarantee.

## Provisioning

Repository names are stable technical keys, one to 64 ASCII characters. They
start and end with a letter or digit and may contain letters, digits, `.`, `_`,
and `-` in between. Display names are trimmed and NFC-normalized, contain one
to 80 Unicode code points, and must not contain control characters.

The JSON request body is optional:

```json
{
  "display_name": "Personal notes",
  "encryption": "encrypted-remote-v1"
}
```

Omitting `encryption` selects `encrypted-remote-v1`. `"plain"` must be
requested explicitly for an unencrypted repository. A new encrypted repository
receives a persisted UUID and an immutable profile. A retry returns the same
identity. An existing repository cannot be reclassified by provisioning it
with another profile.

The response is 201 for a new repository, or 200 for an idempotent retry:

```json
{
  "created": true,
  "namespace": "personal",
  "repository": "notes",
  "name": "notes",
  "display_name": "Personal notes",
  "created_at": 1793318400000,
  "encryption": {
    "profile": "encrypted-remote-v1",
    "version": 1,
    "suite": 1,
    "uuid": "c71a2344-4eb4-4d36-a733-68164d1cde40"
  },
  "remote_url": "https://your-host/personal/notes"
}
```

The UUID and timestamp above are illustrative. `encryption` is `null` for a
plain repository. `created_at` is milliseconds since the Unix epoch. The
display name is a label; it does not change the remote URL or technical key.

## Listing and rename

Listing returns `{"namespace":"personal","repositories":[...]}`. Each
entry has `name`, `display_name`, `created_at`, `encryption`, and `remote_url`.

Send `{"display_name":"New name"}` to PATCH the repository. Renaming does
not change its UUID, encryption profile, references, or remote URL.

## Protocol

Remote v1 traffic is rooted at `/personal/:name` and is handled by the pinned
upstream Graft packages. Provisioning must complete before protocol access.
An unknown repository returns 404 rather than becoming a plain repository.

Clients must use the persisted descriptor to establish the encryption identity.
They must not assume changing a URL migrates an existing encrypted remote.
This management API does not accept encryption passwords or decrypted keys.

## Capabilities and deletion

Discovery advertises `management.version: 1` and
`management.capabilities: ["rename", "delete"]`, alongside the same-origin
`management.repositories` URL. Clients hide actions missing from this declaration;
older discovery responses remain valid for listing and provisioning.

DELETE returns 202 while cleanup is pending, or 200 if already complete. GET status
returns 200. Both use `{namespace: "personal", repository: "notes", status: "deleting"}`;
status is `active`, `deleting`, or `deleted`. Unknown names return 404. Lists include
active/deleting entries with a `status` field, and exclude completed deletions.

Deletion permanently removes the remote copy and history, never local device files.
Admission closes before cleanup, in-flight requests drain, and durable alarms retry
cleanup after failures or restarts. Repeating DELETE is safe. Tombstones retain the
technical name: PUT on a deleted name returns 410. Use a new technical name for a
new repository; display names can be reused without reusing the identity or URL.
There is no general garbage collector for unreachable objects in active repositories.
