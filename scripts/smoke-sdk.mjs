import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { connection, provision } from "./smoke.mjs";

if (!process.env.GRAFT_SDK_PATH) throw new Error("Set GRAFT_SDK_PATH to an E2EE-capable Graft Node SDK package");
const { RepositorySession, EncryptedRemoteSession } = createRequire(import.meta.url)(resolve(process.env.GRAFT_SDK_PATH));
const { origin, token, request } = await connection();
const name = `sdk-smoke-${randomUUID().slice(0, 8)}`;
const remote = await provision(request, name, "encrypted-remote-v1");
assert.equal(remote.remote_url, `${origin}/personal/${name}`, "Remote credentials must stay on the configured repository URL");
assert.equal(remote.repository, name);
assert.equal(remote.encryption.profile, "encrypted-remote-v1");
assert.match(remote.encryption.uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const root = await mkdtemp(join(tmpdir(), "graft-cloudflare-sdk-"));
const sessions = [];
const authorities = [];
const password = randomUUID();
const identity = { name: "Graft Cloudflare Smoke", email: "smoke@example.invalid" };

async function authority(device) {
  const directories = {};
  for (const kind of ["checkpoint", "staging", "recovery"]) {
    const directory = join(root, `${device}-${kind}`);
    EncryptedRemoteSession.createPrivateDirectory(directory);
    directories[`${kind}Directory`] = directory;
  }
  const handle = new EncryptedRemoteSession({
    remoteName: "origin",
    url: remote.remote_url,
    uuid: remote.encryption.uuid,
    authenticationDomain: new URL(origin).hostname,
    accountSubject: "personal",
    bearerToken: token,
    createCheckpoint: true,
    ...directories,
  });
  authorities.push(handle);
  return handle;
}

try {
  const sourcePath = join(root, "source");
  await mkdir(sourcePath);
  const first = await authority("first");
  const source = await RepositorySession.open(sourcePath, { encryptedRemote: first, identity });
  sessions.push(source);
  await source.init();
  await source.addEncryptedRemote();
  const database = new DatabaseSync(join(sourcePath, "notes.sqlite"));
  database.exec("CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT); INSERT INTO notes VALUES (1, 'first device');");
  database.close();
  await writeFile(join(sourcePath, "attachment.txt"), "encrypted attachment");
  await source.addAll();
  await source.commit("Initial encrypted smoke data");
  const commit = (await source.repositoryMetadata()).current_head;
  assert.equal(await first.initializeConfig(Buffer.from(password), { branch: "main", commit }), "config_published");
  const initialized = await source.pushInitialBranch({ verificationDirectory: join(root, "verified") });
  assert.equal(initialized.state, "connected");

  const second = await authority("second");
  await assert.rejects(second.unlock(Buffer.from("incorrect smoke password")));
  await second.unlock(Buffer.from(password));
  const peerPath = join(root, "peer");
  const peer = await RepositorySession.open(peerPath, { encryptedRemote: second, identity });
  sessions.push(peer);
  await peer.cloneEncryptedRemote({ branch: "main" });
  assert.equal(await readFile(join(peerPath, "attachment.txt"), "utf8"), "encrypted attachment");
  const peerDb = new DatabaseSync(join(peerPath, "notes.sqlite"));
  assert.equal(peerDb.prepare("SELECT body FROM notes WHERE id = 1").get().body, "first device");
  peerDb.exec("UPDATE notes SET body = 'second device' WHERE id = 1");
  peerDb.close();
  await writeFile(join(peerPath, "attachment.txt"), "updated on second device");
  await peer.addAll();
  await peer.commit("Second encrypted device update");
  await peer.push({ remote: "origin", branch: "main" });
  await source.pull({ remote: "origin", branch: "main" });
  assert.equal(await readFile(join(sourcePath, "attachment.txt"), "utf8"), "updated on second device");
  const restoredDb = new DatabaseSync(join(sourcePath, "notes.sqlite"));
  assert.equal(restoredDb.prepare("SELECT body FROM notes WHERE id = 1").get().body, "second device");
  restoredDb.close();
  console.log(JSON.stringify({ status: "passed", repository: name, checks: ["native E2EE initialization", "verified first push", "wrong password rejected", "independent device clone", "SQLite and attachment round trip"] }));
} finally {
  const closed = await Promise.allSettled(sessions.reverse().map((session) => session.close()));
  const disconnected = await Promise.allSettled(authorities.reverse().map((handle) => handle.disconnect()));
  await rm(root, { recursive: true, force: true });
  if ([...closed, ...disconnected].some((result) => result.status === "rejected")) {
    console.error("One or more smoke sessions failed to close cleanly");
    process.exitCode = 1;
  }
}
