import { DurableObject } from "cloudflare:workers";
import type { GraftEncryptionDescriptor } from "@eidos.space/graft-remote";

export type EncryptionProfile = "plain" | "encrypted-remote-v1";

export interface RepositoryRecord {
  name: string;
  id: string;
  displayName: string;
  createdAt: number;
  encryption: GraftEncryptionDescriptor | null;
  ready: boolean;
}

interface RepositoryRow {
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
  }

  /** Reserve the identity before any remote I/O so retries always provision the same UUID. */
  async reserve(
    name: string,
    displayName: string,
    profile: EncryptionProfile,
  ): Promise<{ ok: true; created: boolean; repository: RepositoryRecord } | { ok: false; reason: "profile_conflict" }> {
    return this.ctx.storage.transactionSync(() => {
      const previous = this.read(name);
      if (previous !== null) {
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

  async publish(name: string, id: string): Promise<RepositoryRecord> {
    this.ctx.storage.sql.exec("UPDATE repositories SET ready = 1 WHERE name = ? AND id = ?", name, id);
    const repository = this.read(name);
    if (repository === null || repository.id !== id || !repository.ready) {
      throw new Error("Repository provisioning state changed");
    }
    return repository;
  }

  async lookup(name: string): Promise<RepositoryRecord | null> {
    const repository = this.read(name);
    return repository?.ready === true ? repository : null;
  }

  async list(): Promise<RepositoryRecord[]> {
    return this.ctx.storage.sql
      .exec<RepositoryRow>("SELECT * FROM repositories WHERE ready = 1 ORDER BY created_at DESC, name ASC")
      .toArray()
      .map(record);
  }

  async rename(name: string, displayName: string): Promise<RepositoryRecord | null> {
    const repository = this.read(name);
    if (repository === null || !repository.ready) return null;
    this.ctx.storage.sql.exec("UPDATE repositories SET display_name = ? WHERE name = ?", displayName, name);
    return { ...repository, displayName };
  }

  private read(name: string): RepositoryRecord | null {
    const row = this.ctx.storage.sql
      .exec<RepositoryRow>("SELECT * FROM repositories WHERE name = ?", name)
      .toArray()[0];
    return row === undefined ? null : record(row);
  }
}

function record(row: RepositoryRow): RepositoryRecord {
  return {
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
