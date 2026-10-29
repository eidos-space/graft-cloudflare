# Personal Graft Remote

This repository is a standalone Cloudflare template for one owner's Graft
repositories. It uses published Graft Remote v1 packages. Keep protocol,
encryption, CAS, Range, streaming, and storage semantics in those packages.

One deployment has one shared secret and a fixed `personal` URL namespace.
Multiple repositories and devices belong to that same owner. Do not add
tenant routing, user registration, official Eidos authentication, commercial
entitlements, or billing dependencies.

- Preserve changes made by others and use `apply_patch` for edits.
- Use strict TypeScript; avoid `any`, unsafe casts, and secret logging.
- Generate `worker-configuration.d.ts` with `pnpm types` after binding changes.
- Keep all storage bindings account-local and suitable for automatic provisioning.
- Use SQLite-backed Durable Objects so Workers Free remains an eligible plan.
- Keep `GRAFT_REMOTE_TOKEN` out of source, Wrangler vars, URLs, and Git.
- New repositories default to `encrypted-remote-v1`; plain repositories require
  explicit provisioning. Never infer a new plain repository from protocol traffic.
- Update English and Simplified Chinese documentation together.
- Do not claim dashboard deployment, native client compatibility, backup
  completeness, or free-plan capacity without corresponding evidence.

Validation from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm dry-run
```

These checks are local. Running `pnpm deploy` creates or updates Cloudflare
resources; it requires the user's authorization for the target account.
