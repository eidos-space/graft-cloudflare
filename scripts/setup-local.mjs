import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";

const path = new URL("../.dev.vars", import.meta.url);
try {
  await writeFile(path, `GRAFT_REMOTE_TOKEN=${randomBytes(32).toString("base64url")}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  console.log("Created .dev.vars with a random local access token. Existing deployments are unaffected.");
} catch (error) {
  if (error?.code !== "EEXIST") throw error;
  console.log(".dev.vars already exists; kept its current credentials.");
}
