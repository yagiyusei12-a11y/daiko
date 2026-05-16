import { appendFileSync } from "node:fs";
import { join } from "node:path";

const LOG_PATH = join(process.cwd(), "debug-57fb34.log");
const SESSION_ID = "57fb34";

/** Debug mode: append NDJSON (session 57fb34). No secrets/PII. */
export function debugSessionLog(
  location: string,
  message: string,
  data: Record<string, unknown>,
  hypothesisId: string,
): void {
  try {
    const line =
      JSON.stringify({
        sessionId: SESSION_ID,
        timestamp: Date.now(),
        location,
        message,
        data,
        hypothesisId,
      }) + "\n";
    appendFileSync(LOG_PATH, line, "utf8");
  } catch {
    /* ignore */
  }
}
