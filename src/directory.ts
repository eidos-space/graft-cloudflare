import { DurableObject } from "cloudflare:workers";
import type { GraftEncryptionDescriptor } from "@eidos.space/graft-remote";

export type EncryptionProfile = "plain" | "encrypted-remote-v1";

export interface RepositoryRecord {
  status: "active" | "deleting" | "deleted";
  name: string;
  id: string;
  displayName: string;
  createdAt: number;
  encryption: GraftEncryptionDescriptor | null;
  ready: boolean;
}

interface RepositoryRow {
  lifecycle: "active" | "deleting" | "deleted";
  [key: string]: SqlStorageValue;
  name: string;
  id: string;
  display_name: string;
  created_at: number;
  encryption_uuid: string | null;
  ready: number;
}

/** A single directory belongs to this personal deployment, never to an external account. */
export class PersonalDirectoryDurableObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS repositories (
        name TEXT PRIMARY KEY,
        id TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        encryption_uuid TEXT,
        ready INTEGER NOT NULL DEFAULT 0 CHECK (ready IN (0, 1))
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS access_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        token_hash TEXT
      )
    `);
    if (!this.ctx.storage.sql.exec<{ name: string }>("PRAGMA table_info(repositories)").toArray().some(column => column.name === "lifecycle")) {
      this.ctx.storage.sql.exec("ALTER TABLE repositories ADD COLUMN lifecycle TEXT NOT NULL DEFAULT 'active'");
    }
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, name TEXT NOT NULL, expires_at INTEGER NOT NULL)");
  }

  async accessState(): Promise<{ initialized: boolean; tokenHash: string | null }> {
    const row = this.ctx.storage.sql.exec<{ token_hash: string | null }>(
      "SELECT token_hash FROM access_state WHERE id = 1",
    ).toArray()[0];
    const existing = this.ctx.storage.sql.exec<{ present: number }>(
      "SELECT 1 AS present FROM repositories LIMIT 1",
    ).toArray().length > 0;
    return { initialized: row !== undefined || existing, tokenHash: row?.token_hash ?? null };
  }

  async claimAccess(tokenHash: string): Promise<boolean> {
    return this.ctx.storage.transactionSync(() => {
      const exists = this.ctx.storage.sql.exec("SELECT 1 FROM access_state WHERE id = 1").toArray().length > 0;
      const repositories = this.ctx.storage.sql.exec("SELECT 1 FROM repositories LIMIT 1").toArray().length > 0;
      if (exists || repositories) return false;
      this.ctx.storage.sql.exec("INSERT INTO access_state(id, token_hash) VALUES (1, ?)", tokenHash);
      return true;
    });
  }

  /** A dashboard secret replaces any generated credential and permanently closes setup. */
  async useExternalToken(): Promise<void> {
    this.ctx.storage.sql.exec(
      "INSERT INTO access_state(id, token_hash) VALUES (1, NULL) ON CONFLICT(id) DO UPDATE SET token_hash = NULL WHERE token_hash IS NOT NULL",
    );
  }

  /** Reserve the identity before any remote I/O so retries always provision the same UUID. */
  async reserve(
    name: string,
    displayName: string,
    profile: EncryptionProfile,
  ): Promise<{ ok: true; created: boolean; repository: RepositoryRecord } | { ok: false; reason: "profile_conflict" | "repository_deleted" }> {
    return this.ctx.storage.transactionSync(() => {
      const previous = this.read(name);
      if (previous !== null) {
        if (previous.status !== "active") return { ok: false, reason: "repository_deleted" };
        if ((previous.encryption === null ? "plain" : "encrypted-remote-v1") !== profile) {
          return { ok: false, reason: "profile_conflict" };
        }
        return { ok: true, created: false, repository: previous };
      }
      const id = crypto.randomUUID();
      const createdAt = Date.now();
      const encryptionUuid = profile === "plain" ? null : crypto.randomUUID();
      this.ctx.storage.sql.exec(
        "INSERT INTO repositories(name, id, display_name, created_at, encryption_uuid) VALUES (?, ?, ?, ?, ?)",
        name,
        id,
        displayName,
        createdAt,
        encryptionUuid,
      );
      return {
        ok: true,
        created: true,
        repository: {
          status: "active",
          name,
          id,
          displayName,
          createdAt,
          encryption: descriptor(encryptionUuid),
          ready: false,
        },
      };
    });
  }

  async publish(name: string, id: string): Promise<RepositoryRecord | null> {
    this.ctx.storage.sql.exec("UPDATE repositories SET ready = 1 WHERE name = ? AND id = ? AND lifecycle = 'active'", name, id);
    const repository = this.read(name);
    if (repository === null || repository.id !== id || !repository.ready || repository.status !== "active") {
      return null;
    }
    return repository;
  }

  async lookup(name: string): Promise<RepositoryRecord | null> {
    const repository = this.read(name);
    return repository?.ready === true && repository.status === "active" ? repository : null;
  }

  async list(): Promise<RepositoryRecord[]> {
    return this.ctx.storage.sql
      .exec<RepositoryRow>("SELECT * FROM repositories WHERE (ready = 1 OR lifecycle = 'deleting') AND lifecycle != 'deleted' ORDER BY created_at DESC, name ASC")
      .toArray()
      .map(record);
  }

  async rename(name: string, displayName: string): Promise<RepositoryRecord | null> {
    const repository = this.read(name);
    if (repository === null || !repository.ready || repository.status !== "active") return null;
    this.ctx.storage.sql.exec("UPDATE repositories SET display_name = ? WHERE name = ?", displayName, name);
    return { ...repository, displayName };
  }

  private read(name: string): RepositoryRecord | null {
    const row = this.ctx.storage.sql
      .exec<RepositoryRow>("SELECT * FROM repositories WHERE name = ?", name)
      .toArray()[0];
    return row === undefined ? null : record(row);
  }

  status(name: string): RepositoryRecord["status"] | null { return this.read(name)?.status ?? null; }

  acquire(name: string, id: string): boolean {
    if (this.read(name)?.status !== "active") return false;
    this.ctx.storage.sql.exec("INSERT INTO requests(id, name, expires_at) VALUES (?, ?, ?)", id, name, Date.now() + 120_000);
    return true;
  }

  acquireProof(name: string, id: string): boolean | "busy" {
    if (this.read(name)?.status !== "active") return false;
    const active = this.ctx.storage.sql.exec<{ count: number }>(
      "SELECT COUNT(*) AS count FROM requests WHERE name = ? AND id LIKE 'proof:%' AND expires_at > ?",
      name, Date.now(),
    ).toArray()[0]!.count;
    if (active >= 2) return "busy";
    return this.acquire(name, id);
  }

  renew(id: string): void {
    this.ctx.storage.sql.exec("UPDATE requests SET expires_at = ? WHERE id = ?", Date.now() + 120_000, id);
  }

  async finish(id: string): Promise<void> {
    this.ctx.storage.sql.exec("DELETE FROM requests WHERE id = ?", id);
    if (this.pending()) await this.ctx.storage.setAlarm(Date.now() + 1);
  }

  async deleteRepository(name: string): Promise<RepositoryRecord["status"] | null> {
    const row = this.read(name);
    if (!row || row.status === "deleted") return row?.status ?? null;
    // Persist the wakeup before closing admission; a crash cannot strand cleanup.
    await this.ctx.storage.setAlarm(Date.now() + 1);
    this.ctx.storage.sql.exec("UPDATE repositories SET lifecycle = 'deleting' WHERE name = ?", name);
    return "deleting";
  }

  private pending(): RepositoryRow | undefined {
    return this.ctx.storage.sql.exec<RepositoryRow>("SELECT * FROM repositories WHERE lifecycle = 'deleting' ORDER BY created_at LIMIT 1").toArray()[0];
  }

  override async alarm(): Promise<void> {
    const row = this.pending();
    if (!row) return;
    try {
      const requests = this.ctx.storage.sql.exec<{ expires_at: number }>("SELECT expires_at FROM requests WHERE name = ?", row.name).toArray();
      if (requests.length) {
        // Abandoned requests get a second lease interval before cleanup. Live
        // requests renew every 20s; request admission stays closed throughout.
        const safeAt = Math.max(...requests.map(request => request.expires_at)) + 120_000;
        if (Date.now() < safeAt) { await this.ctx.storage.setAlarm(Math.min(safeAt, Date.now() + 10_000)); return; }
        this.ctx.storage.sql.exec("DELETE FROM requests WHERE name = ?", row.name);
      }
      await this.env.REPOSITORIES.getByName(row.id).purgeForDeletion(row.id);
      const objects = await this.env.OBJECTS.list({ prefix: `repositories/${row.id}/`, limit: 256 });
      if (objects.objects.length) {
        await this.env.OBJECTS.delete(objects.objects.map(object => object.key));
        await this.ctx.storage.setAlarm(Date.now() + 1);
        return;
      }
      this.ctx.storage.sql.exec("UPDATE repositories SET lifecycle = 'deleted', display_name = name WHERE name = ?", row.name);
      if (this.pending()) await this.ctx.storage.setAlarm(Date.now() + 1);
    } catch {
      console.error(JSON.stringify({ message: "Repository deletion will retry" }));
      await this.ctx.storage.setAlarm(Date.now() + 30_000);
    }
  }
}

function record(row: RepositoryRow): RepositoryRecord {
  return {
    status: row.lifecycle,
    name: row.name,
    id: row.id,
    displayName: row.display_name,
    createdAt: row.created_at,
    encryption: descriptor(row.encryption_uuid),
    ready: row.ready === 1,
  };
}

function descriptor(uuid: string | null): GraftEncryptionDescriptor | null {
  return uuid === null ? null : { profile: "encrypted-remote-v1", version: 1, suite: 1, uuid };
}
