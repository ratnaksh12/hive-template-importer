import fs from "node:fs";
import path from "node:path";

/**
 * Minimal .env.local loader for the standalone scripts.
 *
 * Next loads .env.local automatically; plain `tsx` does not. Rather than adding
 * dotenv as a dependency for two scripts, parse the handful of lines we need.
 * Existing environment variables always win, so CI can override the file.
 */
export function loadEnv(file = ".env.local"): void {
  const full = path.resolve(file);
  if (!fs.existsSync(full)) return;

  for (const rawLine of fs.readFileSync(full, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    // Strip matching surrounding quotes, if present.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
