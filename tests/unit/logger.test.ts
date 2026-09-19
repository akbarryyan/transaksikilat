import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("initFileLogging", () => {
  let tmpDir: string;
  const originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "logger-test-"));
    vi.resetModules();
  });

  afterEach(() => {
    console.log = originalConsole.log;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("mirrors console.log output into app.log under the given directory", async () => {
    const { initFileLogging } = await import("@/lib/logger");
    initFileLogging(tmpDir);

    console.log("hello world");

    const content = fs.readFileSync(path.join(tmpDir, "app.log"), "utf8");
    expect(content).toContain("[LOG] hello world");
  });

  it("mirrors console.error output, including Error stacks", async () => {
    const { initFileLogging } = await import("@/lib/logger");
    initFileLogging(tmpDir);

    console.error("failed:", new Error("boom"));

    const content = fs.readFileSync(path.join(tmpDir, "app.log"), "utf8");
    expect(content).toContain("[ERROR] failed:");
    expect(content).toContain("boom");
  });

  it("still calls the original console method so stdout/docker logs is unchanged", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { initFileLogging } = await import("@/lib/logger");
    initFileLogging(tmpDir);

    console.log("visible on stdout");

    expect(logSpy).toHaveBeenCalledWith("visible on stdout");
  });

  it("does not wrap console methods twice on repeated calls", async () => {
    const { initFileLogging } = await import("@/lib/logger");
    initFileLogging(tmpDir);
    initFileLogging(tmpDir);

    console.log("only once");

    const content = fs.readFileSync(path.join(tmpDir, "app.log"), "utf8");
    const matches = content.match(/only once/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it("disables itself without throwing when the log directory can't be created", async () => {
    const blockedParent = path.join(tmpDir, "not-a-directory");
    fs.writeFileSync(blockedParent, "im a file, not a dir");
    const unreachableDir = path.join(blockedParent, "sub");

    const { initFileLogging } = await import("@/lib/logger");
    expect(() => initFileLogging(unreachableDir)).not.toThrow();

    expect(() => console.log("still works")).not.toThrow();
  });
});
