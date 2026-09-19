import fs from "node:fs";
import path from "node:path";

/**
 * Mirrors console output into a file on disk so logs survive independently
 * of `docker logs` (which only keeps stdout/stderr, and is lost if the
 * container's log driver rotates or the container is recreated). This does
 * not replace stdout — it's a second destination, written alongside it.
 */

let initialized = false;

const CONSOLE_LEVELS = ["log", "info", "warn", "error"] as const;
type ConsoleLevel = (typeof CONSOLE_LEVELS)[number];

function timestamp(): string {
  return new Date().toISOString();
}

function formatArg(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack ?? value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function initFileLogging(logDir: string = process.env.LOG_DIR || "/app/logs"): void {
  if (initialized) return;

  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch (err) {
    console.error("[logger] Failed to create log directory, file logging disabled:", err);
    return;
  }

  initialized = true;
  const logFile = path.join(logDir, "app.log");

  for (const level of CONSOLE_LEVELS) {
    const original = console[level].bind(console) as (...args: unknown[]) => void;
    console[level as ConsoleLevel] = (...args: unknown[]) => {
      original(...args);
      try {
        const line = `${timestamp()} [${level.toUpperCase()}] ${args.map(formatArg).join(" ")}\n`;
        fs.appendFileSync(logFile, line);
      } catch {
        // A logging failure must never break the caller.
      }
    };
  }
}
