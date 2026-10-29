import { Hono } from "hono";
import { GraftProtocolError, createGraftRemote } from "@eidos.space/graft-remote-hono";
import {
  createEncryptedCloudflareRepository,
  openCloudflareRepository,
  requireBearerToken,
} from "@eidos.space/graft-remote-cloudflare";
import {
  PersonalDirectoryDurableObject,
  type EncryptionProfile,
  type RepositoryRecord,
} from "./directory.js";

export { RepositoryDurableObject } from "@eidos.space/graft-remote-cloudflare";
export { PersonalDirectoryDurableObject } from "./directory.js";

type AppEnv = { Bindings: Env };
const SERVICE = "graft-cloudflare";
const NAMESPACE = "personal";
const MANAGEMENT_BODY_LIMIT = 4096;
const app = new Hono<AppEnv>();

app.use("*", async (context, next) => {
  const url = new URL(context.req.url);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname))) {
    throw new GraftProtocolError(400, "secure_transport_required", "Use HTTPS; HTTP is only allowed on localhost");
  }
  await next();
  context.header("Cache-Control", "no-store");
  context.header("Graft-Protocol", "1");
  context.header("X-Content-Type-Options", "nosniff");
});

app.onError((error) => {
  if (error instanceof GraftProtocolError) {
    return problem(error.status, error.code, error.message, error.headers);
  }
  console.error(JSON.stringify({ message: "personal graft service operation failed" }));
  return problem(500, "internal_error", "Internal server error");
});

app.get("/", (context) => context.json({
  service: SERVICE,
  mode: "personal",
  namespace: NAMESPACE,
  discovery: "/.well-known/graft",
  health: "/healthz",
}));

app.get("/healthz", (context) => {
  const configured = configuredToken(context.env.GRAFT_REMOTE_TOKEN);
  return Response.json(
    { service: SERVICE, status: configured ? "ok" : "not_configured" },
    { status: configured ? 200 : 503 },
  );
});

app.get("/.well-known/graft", (context) => {
  const origin = new URL(context.req.url).origin;
  return context.json({
    service: SERVICE,
    protocol: "graft-remote",
    version: 1,
    remote_url_template: `${origin}/${NAMESPACE}/{repository}`,
    authentication: { scheme: "bearer", authority: origin },
    management: { repositories: `${origin}/api/graft/repositories` },
  });
});

app.use("/api/graft/*", async (context, next) => {
  await authenticate(context.req.raw, context.env);
  await next();
});

app.get("/api/graft/repositories", async (context) => {
  const repositories = await directory(context.env).list();
  return context.json({
    namespace: NAMESPACE,
    repositories: repositories.map((repository) => representation(repository, context.req.url)),
  });
});

app.put("/api/graft/repositories/:name", async (context) => {
  const name = repositoryName(context.req.param("name"));
  const payload = await managementPayload(context.req.raw);
  const displayName = displayNameValue(payload.display_name === undefined ? name : payload.display_name);
  const profile = encryptionProfile(payload.encryption);
  const store = directory(context.env);
  const reservation = await store.reserve(name, displayName, profile);
  if (!reservation.ok) {
    throw new GraftProtocolError(409, "profile_conflict", "The repository encryption profile cannot change");
  }
  const repository = reservation.repository;
  // Directory reservations are durable before this I/O. Concurrent requests and failed
  // responses all retry the same profile and UUID, never create an implicit plain remote.
  if (!repository.ready) {
    const storage = { objects: context.env.OBJECTS, repositories: context.env.REPOSITORIES };
    if (repository.encryption === null) {
      await openCloudflareRepository(storage, repository.id);
    } else {
      await createEncryptedCloudflareRepository(storage, repository.id, repository.encryption.uuid);
    }
    await store.publish(name, repository.id);
  }
  return Response.json(
    {
      created: reservation.created,
      namespace: NAMESPACE,
      repository: name,
      ...representation(repository, context.req.url),
    },
    { status: reservation.created ? 201 : 200 },
  );
});

app.patch("/api/graft/repositories/:name", async (context) => {
  const name = repositoryName(context.req.param("name"));
  const payload = await managementPayload(context.req.raw, true);
  const repository = await directory(context.env).rename(name, displayNameValue(payload.display_name));
  if (repository === null) throw new GraftProtocolError(404, "repository_not_found", "Repository not found");
  return context.json({ namespace: NAMESPACE, repository: name, ...representation(repository, context.req.url) });
});

const remote = createGraftRemote<AppEnv>({
  async authenticate({ request, adapterContext }) {
    await authenticate(request, adapterContext.env);
    return undefined;
  },
  async repositoryId(repository, input) {
    if (repository.namespace !== NAMESPACE) {
      throw new GraftProtocolError(403, "forbidden", "Only the personal namespace is available");
    }
    const found = await directory(input.adapterContext.env).lookup(repository.name);
    if (found === null) throw new GraftProtocolError(404, "repository_not_found", "Repository not found");
    return found.id;
  },
  backend({ adapterContext, repository }) {
    return openCloudflareRepository(
      { objects: adapterContext.env.OBJECTS, repositories: adapterContext.env.REPOSITORIES },
      repository.id,
    );
  },
});
app.route("/", remote);

export default app;

function directory(env: Env): DurableObjectStub<PersonalDirectoryDurableObject> {
  return env.DIRECTORY.getByName("personal");
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function configuredToken(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 32
    && value.length <= 512
    && !/\s/.test(value)
    && !/^(?:replace|change[-_]?me|example|your[-_])/i.test(value)
    && new Set(value).size >= 8;
}

async function authenticate(request: Request, env: Env): Promise<void> {
  if (!configuredToken(env.GRAFT_REMOTE_TOKEN)) {
    throw new GraftProtocolError(503, "service_not_configured", "Configure a strong GRAFT_REMOTE_TOKEN secret");
  }
  await requireBearerToken(request, env.GRAFT_REMOTE_TOKEN);
}

function repositoryName(name: string): string {
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?$/.test(name)) {
    throw new GraftProtocolError(400, "invalid_repository", "Repository names must be 1–64 letters, digits, '.', '_' or '-', with a letter or digit at each end");
  }
  return name;
}

function displayNameValue(value: unknown): string {
  if (typeof value !== "string") throw new GraftProtocolError(400, "invalid_display_name", "A display_name string is required");
  const normalized = value.trim().normalize("NFC");
  if ([...normalized].length < 1 || [...normalized].length > 80 || /\p{Cc}/u.test(normalized)) {
    throw new GraftProtocolError(400, "invalid_display_name", "Display names must contain 1–80 characters without control characters");
  }
  return normalized;
}

function encryptionProfile(value: unknown): EncryptionProfile {
  if (value === undefined || value === "encrypted-remote-v1") return "encrypted-remote-v1";
  if (value === "plain") return "plain";
  throw new GraftProtocolError(400, "invalid_encryption_profile", "Use encrypted-remote-v1 or plain");
}

interface ManagementPayload { display_name?: unknown; encryption?: unknown }

async function managementPayload(request: Request, rename = false): Promise<ManagementPayload> {
  const declaredLength = request.headers.get("Content-Length");
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MANAGEMENT_BODY_LIMIT)) {
    throw new GraftProtocolError(413, "request_too_large", "Management requests are limited to 4096 bytes");
  }
  if (request.body === null) return rename ? missingDisplayName() : {};
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MANAGEMENT_BODY_LIMIT) {
        await reader.cancel();
        throw new GraftProtocolError(413, "request_too_large", "Management requests are limited to 4096 bytes");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (size === 0) return rename ? missingDisplayName() : {};
  if (request.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    throw new GraftProtocolError(415, "unsupported_media_type", "Management request bodies must use application/json");
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new GraftProtocolError(400, "invalid_json", "Invalid JSON request body");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new GraftProtocolError(400, "invalid_payload", "A JSON object is required");
  }
  const allowed = rename ? ["display_name"] : ["display_name", "encryption"];
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new GraftProtocolError(400, "invalid_payload", "Unexpected management field");
  }
  return {
    ...("display_name" in value ? { display_name: value.display_name } : {}),
    ...("encryption" in value ? { encryption: value.encryption } : {}),
  };
}

function missingDisplayName(): never {
  throw new GraftProtocolError(400, "invalid_display_name", "A display_name string is required");
}

function representation(repository: RepositoryRecord, url: string) {
  return {
    name: repository.name,
    display_name: repository.displayName,
    created_at: repository.createdAt,
    encryption: repository.encryption,
    remote_url: `${new URL(url).origin}/${NAMESPACE}/${repository.name}`,
  };
}

function problem(status: number, code: string, message: string, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/problem+json");
  responseHeaders.set("Cache-Control", "no-store");
  responseHeaders.set("Graft-Protocol", "1");
  return new Response(JSON.stringify({ error: { code, message } }), { status, headers: responseHeaders });
}
