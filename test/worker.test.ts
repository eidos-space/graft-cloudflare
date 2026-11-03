import { abortAllDurableObjects, env, SELF, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import app from "../src/index";

const ORIGIN = "https://personal.example";
const TOKEN = "personal-test-token-0123456789abcdef0123456789abcdef";

interface Repository {
  name?: string;
  repository?: string;
  namespace?: string;
  created?: boolean;
  display_name: string;
  created_at: number | string;
  encryption: { profile: string; uuid: string; version: number; suite: number } | null;
  remote_url: string;
}

function request(path: string, init: RequestInit = {}, token = TOKEN): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Graft-Protocol", headers.get("Graft-Protocol") ?? "1");
  return SELF.fetch(`${ORIGIN}${path}`, { ...init, headers });
}

function provision(name: string, value?: Record<string, unknown>): Promise<Response> {
  return request(`/api/graft/repositories/${name}`, {
    method: "PUT",
    ...(value === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }),
  });
}

async function create(name: string, value?: Record<string, unknown>): Promise<Repository> {
  const response = await provision(name, value);
  expect(response.status, await response.clone().text()).toBe(201);
  return (await response.json()) as Repository;
}

const refHeaders = (expected?: string) => ({
  "x-graft-expected-present": String(expected !== undefined),
  "x-graft-expected-hex": expected ?? "",
});

async function decode(response: Response): Promise<string> {
  return new TextDecoder().decode(await response.arrayBuffer());
}

function encryptedObject(length = 104): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length).fill(7);
  bytes.set(new TextEncoder().encode("GRAFTEO1"));
  bytes.set([0, 1, 0, 1], 8);
  bytes.fill(0xaa, 12, 44);
  new DataView(bytes.buffer).setUint32(68, 16);
  return bytes;
}

describe("personal server access and discovery", () => {
  it("drains an actual in-flight upload before removing its late bytes", async () => {
    await create("delete-upload", { encryption: "plain" });
    const directory = env.DIRECTORY.getByName("personal");
    const record = await directory.lookup("delete-upload");
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const proceed = new Promise<void>(resolve => { release = resolve; });
    const objects = new Proxy(env.OBJECTS, {
      get(target, property) {
        if (property === "put") return async (...args: Parameters<R2Bucket["put"]>) => { entered(); await proceed; return target.put(...args); };
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const upload = app.fetch(new Request(`${ORIGIN}/personal/delete-upload/raw-if-not-exists/objects/late`, {
      method: "PUT", body: "late isolated bytes", headers: { Authorization: `Bearer ${TOKEN}`, "Graft-Protocol": "1" },
    }), { ...env, OBJECTS: objects });
    await started;
    await request("/api/graft/repositories/delete-upload", { method: "DELETE" });
    await runDurableObjectAlarm(directory);
    expect(await directory.status("delete-upload")).toBe("deleting");
    release();
    expect((await upload).status).toBe(204);
    for (let i = 0; i < 5 && await directory.status("delete-upload") !== "deleted"; i++) await runDurableObjectAlarm(directory);
    expect(await directory.status("delete-upload")).toBe("deleted");
    expect((await env.OBJECTS.list({ prefix: `repositories/${record!.id}/` })).objects).toHaveLength(0);
    expect((await provision("delete-upload")).status).toBe(410);
  });

  it("cannot publish an initialization that was deleted while storage was opening", async () => {
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const proceed = new Promise<void>(resolve => { release = resolve; });
    const objects = new Proxy(env.OBJECTS, {
      get(target, property) {
        if (property === "list") return async (...args: Parameters<R2Bucket["list"]>) => { entered(); await proceed; return target.list(...args); };
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const initializing = app.fetch(new Request(`${ORIGIN}/api/graft/repositories/delete-init`, {
      method: "PUT", headers: { Authorization: `Bearer ${TOKEN}` },
    }), { ...env, OBJECTS: objects });
    await started;
    const directory = env.DIRECTORY.getByName("personal");
    await request("/api/graft/repositories/delete-init", { method: "DELETE" });
    await runDurableObjectAlarm(directory);
    expect(await directory.status("delete-init")).toBe("deleting");
    release();
    expect((await initializing).status).toBe(410);
    for (let i = 0; i < 5 && await directory.status("delete-init") !== "deleted"; i++) await runDurableObjectAlarm(directory);
    expect(await directory.status("delete-init")).toBe("deleted");
    expect((await provision("delete-init")).status).toBe(410);
  });
  it("deletes isolated remote bytes after draining requests, survives restart, and never reuses the URL", async () => {
    await create("delete-test", { encryption: "plain", display_name: "Same label" });
    let directory = env.DIRECTORY.getByName("personal");
    const record = await directory.lookup("delete-test");
    expect(record).not.toBeNull();
    await env.OBJECTS.put(`repositories/${record!.id}/objects/test`, "isolated bytes");
    expect(await directory.acquire("delete-test", "held-test-request")).toBe(true);
    const route = "/api/graft/repositories/delete-test";
    expect((await request(route, { method: "DELETE" }, "bad")).status).toBe(401);
    const deletion = await request(route, { method: "DELETE" });
    expect(deletion.status).toBe(202);
    expect(await deletion.json()).toMatchObject({ namespace: "personal", repository: "delete-test", status: "deleting" });
    await runDurableObjectAlarm(directory);
    expect(await env.OBJECTS.head(`repositories/${record!.id}/objects/test`)).not.toBeNull();
    expect(await directory.acquire("delete-test", "new-request")).toBe(false);
    expect((await provision("delete-test")).status).toBe(410);
    expect((await request("/personal/delete-test")).status).toBe(404);
    await abortAllDurableObjects();
    directory = env.DIRECTORY.getByName("personal");
    await directory.finish("held-test-request");
    for (let i = 0; i < 5 && await directory.status("delete-test") !== "deleted"; i++) await runDurableObjectAlarm(directory);
    expect(await (await request(route + "/status")).json()).toMatchObject({ status: "deleted" });
    expect((await request(route, { method: "DELETE" })).status).toBe(200);
    expect((await env.OBJECTS.list({ prefix: `repositories/${record!.id}/` })).objects).toHaveLength(0);
    await create("delete-test-new", { display_name: "Same label" });
    expect((await directory.lookup("delete-test-new"))?.id).not.toBe(record!.id);
  });

  it("recovers cleanup after an abandoned initialization lease", async () => {
    let directory = env.DIRECTORY.getByName("personal");
    await directory.reserve("abandoned-delete", "Draft", "encrypted-remote-v1");
    await directory.acquire("abandoned-delete", "lost-test-request");
    await directory.deleteRepository("abandoned-delete");
    await runInDurableObject(directory, async (_instance, state) => {
      state.storage.sql.exec("UPDATE requests SET expires_at = 0 WHERE name = 'abandoned-delete'");
    });
    await abortAllDurableObjects();
    directory = env.DIRECTORY.getByName("personal");
    await runDurableObjectAlarm(directory);
    expect(await directory.status("abandoned-delete")).toBe("deleted");
    expect(await directory.publish("abandoned-delete", "old-id")).toBeNull();
  });
  it("advertises its own origin without an account or an access token", async () => {
    const health = await SELF.fetch(`${ORIGIN}/healthz`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ service: "graft-cloudflare", status: "ok" });
    const discovery = await SELF.fetch(`${ORIGIN}/.well-known/graft`);
    expect(discovery.status).toBe(200);
    expect(await discovery.json()).toMatchObject({
      service: "graft-cloudflare",
      protocol: "graft-remote",
      version: 1,
      remote_url_template: `${ORIGIN}/personal/{repository}`,
      authentication: { scheme: "bearer", authority: ORIGIN },
      management: { repositories: `${ORIGIN}/api/graft/repositories` },
    });
  });

  it("does not disclose repositories to an absent or invalid credential", async () => {
    await create("private-list");
    const absent = await SELF.fetch(`${ORIGIN}/api/graft/repositories`);
    expect(absent.status).toBe(401);
    expect(absent.headers.get("www-authenticate")).toContain("Bearer");
    expect(await absent.text()).not.toContain("private-list");
    const wrong = await request("/api/graft/repositories", {}, "wrong-token");
    expect(wrong.status).toBe(401);
    expect(await wrong.text()).not.toContain("private-list");
    const deniedWrite = await request("/api/graft/repositories/denied", { method: "PUT" }, "wrong");
    expect(deniedWrite.status).toBe(401);
    await deniedWrite.body?.cancel();
    const listing = await request("/api/graft/repositories");
    expect(await listing.text()).not.toContain("denied");
  });

  it("rejects cleartext remote access while allowing local development", async () => {
    const insecure = await SELF.fetch("http://personal.example/api/graft/repositories", {
      headers: { Authorization: `Bearer ${TOKEN}`, "X-Forwarded-Proto": "https" },
    });
    expect(insecure.status).toBe(400);
    await insecure.body?.cancel();
    const local = await SELF.fetch("http://127.0.0.1:8787/api/graft/repositories", {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(local.status).toBe(200);
    await local.body?.cancel();
  });

  it.each(["", "short", "replace-with-a-long-random-secret-token"])(
    "fails closed with an unconfigured or insecure deployment secret (%s)",
    async (secret) => {
      const response = await app.fetch(
        new Request(`${ORIGIN}/api/graft/repositories`, {
          headers: { Authorization: `Bearer ${secret || TOKEN}` },
        }),
        { ...env, GRAFT_REMOTE_TOKEN: secret },
      );
      expect(response.status).toBe(503);
      const body = await response.text();
      expect(body).not.toContain(TOKEN);
      if (secret.length > 8) expect(body).not.toContain(secret);
    },
  );

  it("does not create a plain repository through a protocol read or write", async () => {
    for (const [path, method] of [
      ["/personal/missing", "GET"],
      ["/personal/missing/raw-if-not-exists/HEAD", "PUT"],
    ] as const) {
      const response = await request(path, { method, ...(method === "PUT" ? { body: "head" } : {}) });
      expect(response.status).toBe(404);
      expect(response.headers.get("graft-protocol")).toBe("1");
      await response.body?.cancel();
    }
    const created = await create("missing");
    expect(created.encryption?.profile).toBe("encrypted-remote-v1");
  });

  it("rejects other namespaces even when the shared token is valid", async () => {
    await create("namespace-check", { encryption: "plain" });
    const response = await request("/someone-else/namespace-check");
    expect(response.status).toBe(403);
    await response.body?.cancel();
  });

  it("negotiates the protocol and returns private non-cacheable responses", async () => {
    await create("versions", { encryption: "plain" });
    const unsupported = await request("/personal/versions", { headers: { "Graft-Protocol": "2" } });
    expect(unsupported.status).toBe(426);
    expect(unsupported.headers.get("graft-protocol")).toBe("1");
    await unsupported.body?.cancel();
    const response = await request("/personal/versions");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const descriptor = (await response.json()) as { repository: string };
    expect(descriptor).toMatchObject({
      protocol: "graft-remote",
      version: 1,
    });
    expect(descriptor.repository).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("explicit personal repository provisioning", () => {
  it("creates encrypted repositories by default and retains their identity across a restart", async () => {
    const created = await create("encrypted-default", { display_name: "  Personal Space  " });
    expect(created).toMatchObject({
      created: true,
      namespace: "personal",
      repository: "encrypted-default",
      display_name: "Personal Space",
      remote_url: `${ORIGIN}/personal/encrypted-default`,
      encryption: { profile: "encrypted-remote-v1", version: 1, suite: 1 },
    });
    expect(created.encryption?.uuid).toMatch(/^[0-9a-f-]{36}$/);
    await abortAllDurableObjects();
    const repeated = await provision("encrypted-default");
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toMatchObject({
      created: false,
      encryption: created.encryption,
      display_name: "Personal Space",
      created_at: created.created_at,
    });
    const descriptor = await request("/personal/encrypted-default");
    expect(await descriptor.json()).toMatchObject({ encryption: created.encryption });
  });

  it("concurrent creation returns one stable encryption UUID", async () => {
    const responses = await Promise.all(Array.from({ length: 4 }, () => provision("raced-create")));
    expect(responses.map((value) => value.status).sort()).toEqual([200, 200, 200, 201]);
    const repositories = (await Promise.all(responses.map((value) => value.json()))) as Repository[];
    expect(new Set(repositories.map((value) => value.encryption?.uuid)).size).toBe(1);
    expect(repositories.filter((value) => value.created)).toHaveLength(1);
  });

  it("keeps interrupted provisioning hidden and retries its reserved identity", async () => {
    const failingObjects = new Proxy(env.OBJECTS, {
      get(target, property) {
        if (property === "list") return () => Promise.reject(new Error("test storage unavailable"));
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const failed = await app.fetch(new Request(`${ORIGIN}/api/graft/repositories/retry-provision`, {
      method: "PUT", headers: { Authorization: `Bearer ${TOKEN}` },
    }), { ...env, OBJECTS: failingObjects });
    expect(failed.status).toBe(500);
    expect(await failed.text()).not.toContain("test storage unavailable");
    const listing = await request("/api/graft/repositories");
    expect(await listing.text()).not.toContain("retry-provision");
    const missing = await request("/personal/retry-provision");
    expect(missing.status).toBe(404);
    await missing.body?.cancel();
    await abortAllDurableObjects();
    const recovered = await provision("retry-provision");
    expect(recovered.status).toBe(200);
    const repository = (await recovered.json()) as Repository;
    expect(repository.created).toBe(false);
    expect(repository.encryption?.profile).toBe("encrypted-remote-v1");
    const repeated = await provision("retry-provision");
    expect(await repeated.json()).toMatchObject({ encryption: repository.encryption });
  });

  it("never converts an existing repository between plain and encrypted profiles", async () => {
    await create("keep-encrypted");
    const downgrade = await provision("keep-encrypted", { encryption: "plain" });
    expect(downgrade.status).toBe(409);
    await downgrade.body?.cancel();
    const created = await create("keep-plain", { encryption: "plain" });
    expect(created.encryption).toBeNull();
    const upgrade = await provision("keep-plain", { encryption: "encrypted-remote-v1" });
    expect(upgrade.status).toBe(409);
    await upgrade.body?.cancel();
  });

  it("does not permit competing plain and encrypted creation to change the winning profile", async () => {
    const responses = await Promise.all([
      provision("profile-race", { encryption: "plain" }),
      provision("profile-race", { encryption: "encrypted-remote-v1" }),
    ]);
    expect(responses.map((value) => value.status).sort()).toEqual([201, 409]);
    const winner = responses.find((value) => value.status === 201)!;
    const created = (await winner.json()) as Repository;
    await responses.find((value) => value.status === 409)!.body?.cancel();
    await abortAllDurableObjects();
    const descriptor = await request("/personal/profile-race");
    const profile = (await descriptor.json()) as { encryption?: Repository["encryption"] };
    expect(profile.encryption ?? null).toEqual(created.encryption);
  });

  it("lists ready repositories without including the access secret", async () => {
    const created = await create("listed-repo", { display_name: "我的空间" });
    const listing = await request("/api/graft/repositories");
    const body = await listing.text();
    expect(body).not.toContain(TOKEN);
    const result = JSON.parse(body) as { namespace: string; repositories: Repository[] };
    expect(result.namespace).toBe("personal");
    expect(result.repositories).toContainEqual(expect.objectContaining({
      name: "listed-repo",
      display_name: "我的空间",
      encryption: created.encryption,
      remote_url: created.remote_url,
    }));
  });

  it("changes the display label without changing repository identity or URL", async () => {
    const created = await create("rename-label");
    const renamed = await request("/api/graft/repositories/rename-label", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ display_name: "  Cafe\u0301  " }),
    });
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({
      display_name: "Café",
      remote_url: created.remote_url,
      encryption: created.encryption,
    });
  });

  it.each(["bad!name", "_leading", "trailing-", "a".repeat(65)])(
    "rejects a repository name outside the protocol contract (%s)",
    async (name) => {
      const response = await provision(encodeURIComponent(name));
      expect(response.status).toBe(400);
      await response.body?.cancel();
    },
  );

  it.each([
    { display_name: "" },
    { display_name: "a".repeat(81) },
    { display_name: "control\ncharacter" },
    { display_name: "control\u0085character" },
    { encryption: "none" },
    { password: "must-not-be-a-server-input" },
    { uuid: "caller-must-not-choose-identity" },
  ])("rejects invalid or unsupported provisioning fields (%j)", async (value) => {
    const response = await provision("invalid-body", value);
    expect(response.status).toBe(400);
    await response.body?.cancel();
  });

  it("bounds request bodies and checks their content type and syntax", async () => {
    const tooLarge = await request("/api/graft/repositories/oversized", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ display_name: "a".repeat(5000) }),
    });
    expect(tooLarge.status).toBe(413);
    await tooLarge.body?.cancel();
    const wrongType = await request("/api/graft/repositories/wrong-type", { method: "PUT", body: "{}" });
    expect(wrongType.status).toBe(415);
    await wrongType.body?.cancel();
    const malformed = await request("/api/graft/repositories/malformed", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: "{",
    });
    expect(malformed.status).toBe(400);
    await malformed.body?.cancel();
  });
});

describe("Graft storage through the personal service", () => {
  it("keeps immutable objects create-only and streams exact byte ranges", async () => {
    await create("plain-objects", { encryption: "plain" });
    const path = "/personal/plain-objects/raw-if-not-exists/objects/pack/data.pack";
    expect((await request(path, { method: "PUT", body: "abcdef" })).status).toBe(204);
    const collision = await request(path, { method: "PUT", body: "changed" });
    expect(collision.status).toBe(412);
    await collision.body?.cancel();
    const range = await request("/personal/plain-objects/raw/objects/pack/data.pack", {
      headers: { Range: "bytes=1-3" },
    });
    expect(range.status).toBe(206);
    expect(range.headers.get("content-range")).toBe("bytes 1-3/6");
    expect(await decode(range)).toBe("bcd");
    const full = await request("/personal/plain-objects/raw/objects/pack/data.pack");
    expect(await decode(full)).toBe("abcdef");
  });

  it("permits only one concurrent update of a reference and retains the winner after eviction", async () => {
    await create("plain-cas", { encryption: "plain" });
    const path = "/personal/plain-cas/cas/refs/heads/main";
    expect((await request(path, { method: "POST", headers: refHeaders(), body: "a\n" })).status).toBe(204);
    const contenders = await Promise.all(["b\n", "c\n"].map((body) => request(path, {
      method: "POST", headers: refHeaders("610a"), body,
    })));
    expect(contenders.map((value) => value.status).sort()).toEqual([204, 409]);
    await Promise.all(contenders.map((value) => value.body?.cancel()));
    await abortAllDurableObjects();
    const current = await request("/personal/plain-cas/raw/refs/heads/main");
    expect(["b\n", "c\n"]).toContain(await decode(current));
  });

  it("isolates different repositories belonging to the same owner", async () => {
    await create("isolation-one", { encryption: "plain" });
    await create("isolation-two", { encryption: "plain" });
    expect((await request("/personal/isolation-one/raw-if-not-exists/objects/data", {
      method: "PUT", body: "private-to-one",
    })).status).toBe(204);
    const absent = await request("/personal/isolation-two/raw/objects/data");
    expect(absent.status).toBe(404);
    await absent.body?.cancel();
  });

  it("persists opaque encrypted reference bytes and rejects plaintext writes", async () => {
    await create("encrypted-bytes");
    const refKey = `e2ee/refs/${"c".repeat(64)}`;
    const reference = new Uint8Array(85);
    reference.set(new TextEncoder().encode("GRAFTER1"));
    reference.set([0, 1, 0, 1, 1], 8);
    const written = await request(`/personal/encrypted-bytes/cas/${refKey}`, {
      method: "POST", headers: refHeaders(), body: reference,
    });
    expect(written.status, await written.clone().text()).toBe(204);
    await abortAllDurableObjects();
    const read = await request(`/personal/encrypted-bytes/raw/${refKey}`);
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(reference);
    const plain = await request("/personal/encrypted-bytes/raw-if-not-exists/objects/plain", {
      method: "PUT", body: "plaintext",
    });
    expect(plain.status).toBe(400);
    await plain.body?.cancel();
  });

  it("resumes encrypted multipart bytes across eviction and publishes only a verified completion", async () => {
    const created = await create("encrypted-multipart");
    const key = `e2ee/files/${"b".repeat(64)}`;
    const bytes = encryptedObject(6 * 1024 * 1024);
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
      .map((value) => value.toString(16).padStart(2, "0")).join("");
    const start = () => request(`/personal/encrypted-multipart/multipart-start/${key}`, {
      method: "POST",
      headers: {
        "content-length": "0", "x-graft-object-bytes": String(bytes.length),
        "x-graft-e2ee-uuid": created.encryption!.uuid,
        "x-graft-e2ee-upload-id": "a".repeat(64),
        "x-graft-e2ee-ciphertext-sha256": digest,
      },
    });
    const started = await start();
    expect(started.status, await started.clone().text()).toBe(200);
    const session = (await started.json()) as { upload_id: string };
    expect((await request(`/personal/encrypted-multipart/multipart-part/${key}`, {
      method: "PUT", body: bytes,
      headers: {
        "content-length": String(bytes.length), "x-graft-upload-id": session.upload_id,
        "x-graft-part-number": "1",
      },
    })).status).toBe(204);
    const unpublished = await request(`/personal/encrypted-multipart/raw/${key}`);
    expect(unpublished.status).toBe(404);
    await unpublished.body?.cancel();
    await abortAllDurableObjects();
    const resumed = await start();
    expect(await resumed.json()).toMatchObject({
      upload_id: session.upload_id,
      uploaded_parts: [{ part_number: 1, bytes: bytes.length }],
    });
    const completed = await request(`/personal/encrypted-multipart/multipart-complete/${key}`, {
      method: "POST",
      headers: { "content-length": "0", "x-graft-upload-id": session.upload_id },
    });
    expect(completed.status, await completed.clone().text()).toBe(204);
    const result = await request(`/personal/encrypted-multipart/raw/${key}`, { headers: { Range: "bytes=0-71" } });
    expect(result.status).toBe(206);
    expect(new Uint8Array(await result.arrayBuffer())).toEqual(bytes.slice(0, 72));
  });
});
