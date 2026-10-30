# Validation status

[简体中文](VALIDATION.zh-CN.md)

Verified locally on 2026-10-30. A local runtime test or deployment dry run does
not establish successful Cloudflare dashboard deployment or free-plan capacity.

## Completed checks

- `pnpm install`: standalone published dependencies, with no workspace links.
- `pnpm check`: generated binding types match Wrangler; strict TypeScript passes.
- `pnpm test`: 36 Workers-runtime integration tests pass, including one-time
  setup, concurrent claims, and secret-based recovery.
- `pnpm dry-run`: deployable bundle generated;
  R2 and both SQLite Durable Object bindings are present.
- `pnpm smoke`: HTTP encrypted provisioning/descriptor, plain create-only writes,
  and Range reads pass against local Wrangler after claiming a generated key.
- Before this setup change, `pnpm smoke:sdk` passed: real native E2EE initialization, verified first push, wrong
  password rejection, independent device clone/unlock, and SQLite plus attachment
  updates returning to the first device pass against local Wrangler.

Integration tests cover HTTPS/loopback enforcement, shared-token authorization
and unsuitable/missing-secret rejection, explicit provisioning, UUID persistence,
concurrent and interrupted creation recovery, immutable profile selection,
repository isolation, CAS contention, Range, Durable Object eviction, opaque
encrypted references, and 6 MiB encrypted multipart resume/publication.

The native smoke used an `e2ee` feature build of Graft SDK 0.3.35 at
`bcd0cd6c23e0611f20a16b040a8bf00afa029731`, with published Remote packages 0.2.5.
This is evidence for that locally built SDK/server combination, not for every
released Lite or mobile client. An older local addon lacked required SDK entry
points and was not used as passing compatibility evidence.

Wrangler 4.155.0 and the current test plugin bundle a runtime supporting
compatibility date 2026-10-23, which is the pinned date tested here. Published
Graft packages emit missing-source sourcemap warnings; all tests still pass.

## Cloudflare dashboard acceptance still required

1. Exercise the public Deploy to Cloudflare button in an account with R2 enabled.
2. Confirm it needs no pre-generated token, creates a private account-local
   bucket and both SQLite DO bindings, and needs no official Eidos account.
   Complete `/setup`, verify its one-time key and recovery, and redeploy.
3. Repeat encrypted push, clone/unlock, and pull against the deployed origin.
4. Redeploy to the same Worker and verify UUID and data persistence.
5. Measure actual request CPU and storage usage before promising free-plan
   capacity for a specific workload.

No Cloudflare resources were deployed by these local checks. The released Lite
UI does not yet expose custom self-host connections. This version has no
coordinated server backup/restore, repository deletion API, or automatic GC.
