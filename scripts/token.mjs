import { randomBytes } from "node:crypto";

// This command deliberately prints a new credential for the deployment owner.
process.stdout.write(`${randomBytes(32).toString("base64url")}\n`);
