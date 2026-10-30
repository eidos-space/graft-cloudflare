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

The final three endpoints require the shared token. The fixed `personal`
protocol namespace does not represent an account or tenant.

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

There is no repository deletion or garbage-collection endpoint in this version.
