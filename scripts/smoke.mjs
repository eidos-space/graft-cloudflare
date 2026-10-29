import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

export async function connection() {
  const origin = new URL(process.env.GRAFT_SMOKE_ORIGIN ?? "http://127.0.0.1:8787");
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") {
    throw new Error("GRAFT_SMOKE_ORIGIN must be an origin without credentials, paths or query parameters");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (origin.protocol !== "https:" && !(local && origin.protocol === "http:")) {
    throw new Error("HTTPS is required outside loopback development");
  }
  let token = process.env.GRAFT_REMOTE_TOKEN;
  if (!token && local) {
    const variables = parseEnv(await readFile(new URL("../.dev.vars", import.meta.url), "utf8"));
    token = variables.GRAFT_REMOTE_TOKEN;
  }
  if (!token) throw new Error("Set GRAFT_REMOTE_TOKEN for the intended server");
  async function request(path, options = {}) {
    const destination = new URL(path, origin);
    if (destination.origin !== origin.origin || destination.username || destination.password) {
      throw new Error("Refusing to forward credentials outside the configured origin");
    }
    const headers = new Headers(options.headers);
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("Graft-Protocol", "1");
    const response = await fetch(destination, {
      ...options,
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new Error("The server redirected a credential-bearing request");
    }
    return response;
  }
  return { origin: origin.origin, token, request };
}

export async function provision(request, name, encryption) {
  const response = await request(`/api/graft/repositories/${name}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ display_name: name, encryption }),
  });
  assert.equal(response.status, 201, "Smoke checks require a new repository");
  return response.json();
}

async function main() {
  const { request } = await connection();
  const prefix = `smoke-${randomUUID().slice(0, 8)}`;
  const encrypted = await provision(request, `${prefix}-encrypted`, "encrypted-remote-v1");
  assert.equal(encrypted.encryption.profile, "encrypted-remote-v1");
  const descriptor = await request(`/personal/${encrypted.repository}`);
  assert.equal(descriptor.status, 200);
  assert.equal((await descriptor.json()).encryption.uuid, encrypted.encryption.uuid);

  const plain = await provision(request, `${prefix}-plain`, "plain");
  const base = `/personal/${plain.repository}`;
  const upload = await request(`${base}/raw-if-not-exists/store/smoke`, { method: "PUT", body: "hello graft" });
  assert.equal(upload.status, 204);
  const duplicate = await request(`${base}/raw-if-not-exists/store/smoke`, { method: "PUT", body: "replacement" });
  assert.equal(duplicate.status, 412);
  await duplicate.body?.cancel();
  const download = await request(`${base}/raw/store/smoke`, { headers: { Range: "bytes=0-4" } });
  assert.equal(download.status, 206);
  assert.equal(await download.text(), "hello");
  console.log(JSON.stringify({ status: "passed", checks: ["encrypted provisioning", "descriptor", "create-only", "range"], repositories: [encrypted.repository, plain.repository] }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
