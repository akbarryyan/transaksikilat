import { describe, expect, it } from "vitest";

import { matchesImageSignature } from "@/lib/upload";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const GIF87_SIGNATURE = Buffer.from("GIF87a", "ascii");
const GIF89_SIGNATURE = Buffer.from("GIF89a", "ascii");
const WEBP_SIGNATURE = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
  Buffer.from("WEBP", "ascii"),
]);
const HTML_POLYGLOT = Buffer.from("<script>alert(document.cookie)</script>", "ascii");

describe("matchesImageSignature", () => {
  it("accepts real image bytes for their matching declared type", () => {
    expect(matchesImageSignature(PNG_SIGNATURE, "image/png")).toBe(true);
    expect(matchesImageSignature(JPEG_SIGNATURE, "image/jpeg")).toBe(true);
    expect(matchesImageSignature(GIF87_SIGNATURE, "image/gif")).toBe(true);
    expect(matchesImageSignature(GIF89_SIGNATURE, "image/gif")).toBe(true);
    expect(matchesImageSignature(WEBP_SIGNATURE, "image/webp")).toBe(true);
  });

  it("rejects content whose bytes don't match the declared type", () => {
    // The actual attack this guards against: an upload declares a spoofed
    // Content-Type (fully attacker-controlled) while the bytes are something
    // else entirely.
    expect(matchesImageSignature(HTML_POLYGLOT, "image/png")).toBe(false);
    expect(matchesImageSignature(HTML_POLYGLOT, "image/jpeg")).toBe(false);
    expect(matchesImageSignature(HTML_POLYGLOT, "image/gif")).toBe(false);
    expect(matchesImageSignature(HTML_POLYGLOT, "image/webp")).toBe(false);
  });

  it("rejects one image format's bytes declared as another", () => {
    expect(matchesImageSignature(PNG_SIGNATURE, "image/jpeg")).toBe(false);
    expect(matchesImageSignature(JPEG_SIGNATURE, "image/gif")).toBe(false);
    expect(matchesImageSignature(GIF89_SIGNATURE, "image/webp")).toBe(false);
  });

  it("rejects a WEBP-shaped RIFF container carrying a different fourCC", () => {
    const riffButNotWebp = Buffer.concat([
      Buffer.from("RIFF", "ascii"),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from("AVI ", "ascii"),
    ]);
    expect(matchesImageSignature(riffButNotWebp, "image/webp")).toBe(false);
  });

  it("rejects buffers too short to contain a signature", () => {
    expect(matchesImageSignature(Buffer.from([0x89, 0x50]), "image/png")).toBe(false);
    expect(matchesImageSignature(Buffer.alloc(0), "image/jpeg")).toBe(false);
  });
});
