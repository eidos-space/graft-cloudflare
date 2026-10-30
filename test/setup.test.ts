import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import app from "../src/index";

const origin = "https://setup.example";
const external = "recovery-token-0123456789abcdef0123456789abcdef";

function isolated() {
  const id = crypto.randomUUID();
  const namespace = new Proxy(env.DIRECTORY, {
    get(target, property, receiver) {
      if (property === "getByName") return () => target.getByName(id);
      return Reflect.get(target, property, receiver);
    },
  });
  return { ...env, DIRECTORY: namespace, GRAFT_REMOTE_TOKEN: undefined as string | undefined };
}

function call(bindings: ReturnType<typeof isolated>, path: string, init?: RequestInit) {
  return app.fetch(new Request(`${origin}${path}`, init), bindings);
}

describe("first setup", () => {
  it("allows exactly one same-origin claim, stores only a digest, and authenticates that key", async () => {
    const bindings = isolated();
    expect((await call(bindings, "/healthz")).status).toBe(503);
    const page = await call(bindings, "/setup");
    expect(page.status).toBe(200);
    // A no-referrer policy makes browsers send Origin: null on form POSTs.
    expect(page.headers.get("Referrer-Policy")).toBe("same-origin");
    expect((await call(bindings, "/setup", { method: "POST", headers: { Origin: "null" } })).status).toBe(403);
    expect((await call(bindings, "/setup", { method: "POST", headers: { Origin: "https://elsewhere.example" } })).status).toBe(403);
    const attempts = await Promise.all(Array.from({ length: 8 }, () => call(bindings, "/setup", { method: "POST", headers: { Origin: origin } })));
    expect(attempts.filter((result) => result.status === 200)).toHaveLength(1);
    expect(attempts.filter((result) => result.status === 409)).toHaveLength(7);
    const body = await attempts.find((result) => result.status === 200)!.text();
    const token = body.match(/<pre>([A-Za-z0-9_-]{43})<\/pre>/)?.[1];
    expect(token).toBeDefined();
    expect(attempts.find((result) => result.status === 200)?.headers.get("Referrer-Policy")).toBe("no-referrer");
    const stored = await bindings.DIRECTORY.getByName("personal").accessState();
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.tokenHash).not.toContain(token);
    expect((await call(bindings, "/healthz")).status).toBe(200);
    expect((await call(bindings, "/api/graft/repositories", { headers: { Authorization: `Bearer ${token}` } })).status).toBe(200);
    expect((await call(bindings, "/api/graft/repositories", { headers: { Authorization: "Bearer wrong" } })).status).toBe(401);
    const again = await call(bindings, "/setup");
    expect(again.status).toBe(409);
    expect(await again.text()).not.toContain(token);
  });

  it("lets a Cloudflare secret replace a lost key without reopening setup", async () => {
    const bindings = isolated();
    const claimed = await call(bindings, "/setup", { method: "POST", headers: { Origin: origin } });
    const token = (await claimed.text()).match(/<pre>([A-Za-z0-9_-]{43})<\/pre>/)?.[1];
    const recovered = { ...bindings, GRAFT_REMOTE_TOKEN: external };
    expect((await call(recovered, "/api/graft/repositories", { headers: { Authorization: `Bearer ${external}` } })).status).toBe(200);
    expect((await call(recovered, "/api/graft/repositories", { headers: { Authorization: `Bearer ${token}` } })).status).toBe(401);
    expect((await call(bindings, "/setup")).status).toBe(409);
    expect((await call(bindings, "/healthz")).status).toBe(503);
  });

  it("never permits claiming an existing repository when its old secret is missing", async () => {
    const bindings = isolated();
    await bindings.DIRECTORY.getByName("personal").reserve("old", "Old", "plain");
    expect((await call(bindings, "/setup", { method: "POST", headers: { Origin: origin } })).status).toBe(409);
    expect((await call(bindings, "/healthz")).status).toBe(503);
  });
});
