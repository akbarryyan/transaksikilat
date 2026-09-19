import { unlink } from "fs/promises";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { saveUploadedImage, UploadError } from "@/lib/upload";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const HTML_POLYGLOT = Buffer.from("<script>alert(document.cookie)</script>", "ascii");

const writtenPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    writtenPaths.splice(0).map((p) => unlink(path.join(process.cwd(), "public", p)).catch(() => {}))
  );
});

function fakeFile(bytes: Buffer, type: string): File {
  return new File([new Uint8Array(bytes)], "upload.bin", { type });
}

describe("saveUploadedImage", () => {
  it("saves a file whose bytes match its declared image type", async () => {
    const stored = await saveUploadedImage(fakeFile(PNG_BYTES, "image/png"), "site");
    writtenPaths.push(stored);

    expect(stored).toMatch(/^\/uploads\/site\/[\w-]+\.png$/);
  });

  it("rejects content that doesn't match its declared Content-Type, without writing anything", async () => {
    // The actual attack: an attacker sets Content-Type: image/png on a
    // multipart field — fully client-controlled — while the bytes are
    // something else entirely.
    await expect(
      saveUploadedImage(fakeFile(HTML_POLYGLOT, "image/png"), "site")
    ).rejects.toThrow(UploadError);
  });

  it("rejects a declared type that doesn't match any supported format at all", async () => {
    await expect(
      saveUploadedImage(fakeFile(PNG_BYTES, "image/svg+xml"), "site")
    ).rejects.toThrow(UploadError);
  });
});
