import { RepositoryDurableObject as BaseRepository } from "@eidos.space/graft-remote-cloudflare";

/** Pinned to the published 0.2.5 storage layout. Only directory cleanup calls this. */
export class RepositoryDurableObject extends BaseRepository {
  async purgeForDeletion(repositoryId: string): Promise<void> {
    if (!/^[0-9a-f-]{36}$/.test(repositoryId) || !this.ctx.id.equals(this.env.REPOSITORIES.idFromName(repositoryId))) throw new Error("Invalid repository identity");
    const exists = this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'multipart_uploads'").toArray().length > 0;
    if (exists) {
      for (const row of this.ctx.storage.sql.exec<{ path: string; upload_id: string }>("SELECT path, upload_id FROM multipart_uploads").toArray()) {
        await this.env.OBJECTS.resumeMultipartUpload(`repositories/${repositoryId}/objects/${row.path}`, row.upload_id).abort();
        await this.deleteMultipartUpload(row.path, row.upload_id);
      }
    }
    await this.ctx.storage.deleteAll();
  }
}
