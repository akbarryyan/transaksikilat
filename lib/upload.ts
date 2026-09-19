import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { z } from "zod";

export const UPLOAD_FOLDERS = ["promos", "brands", "banners", "payment-methods", "sellers", "site", "footer"] as const;
export type UploadFolder = (typeof UPLOAD_FOLDERS)[number];

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * Checks the file's actual leading bytes against its declared MIME type.
 * `file.type` on an upload is client-supplied — the Content-Type of a
 * multipart form field — so trusting it alone lets an attacker upload
 * arbitrary content under an "image/png" label. This never inspects the
 * whole file, only the handful of bytes that make each format identifiable.
 */
export function matchesImageSignature(buffer: Buffer, declaredType: string): boolean {
  switch (declaredType) {
    case "image/png":
      return (
        buffer.length >= 8 &&
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0d &&
        buffer[5] === 0x0a &&
        buffer[6] === 0x1a &&
        buffer[7] === 0x0a
      );
    case "image/jpeg":
      return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    case "image/gif": {
      if (buffer.length < 6) return false;
      const header = buffer.subarray(0, 6).toString("ascii");
      return header === "GIF87a" || header === "GIF89a";
    }
    case "image/webp":
      return (
        buffer.length >= 12 &&
        buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
        buffer.subarray(8, 12).toString("ascii") === "WEBP"
      );
    default:
      return false;
  }
}

/**
 * Accepts both legacy absolute URLs (third-party hosting, e.g. https://i.ibb.co.com/...)
 * and local paths produced by /api/upload (e.g. /uploads/promos/xxx.png), so existing
 * stored values keep working while new uploads use local storage.
 */
export const imageRefSchema = z
  .string()
  .refine(
    (value) => /^https?:\/\//i.test(value) || value.startsWith("/uploads/"),
    "URL atau path gambar tidak valid"
  );

export class UploadError extends Error {
  constructor(message: string, public status: number = 400) {
    super(message);
  }
}

export async function saveUploadedImage(file: File, folder: UploadFolder): Promise<string> {
  if (!MIME_EXTENSIONS[file.type]) {
    throw new UploadError("Format gambar tidak didukung. Gunakan PNG, JPG, WEBP, atau GIF.");
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new UploadError("Ukuran gambar maksimal 5MB.");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (!matchesImageSignature(buffer, file.type)) {
    throw new UploadError("Isi file tidak sesuai dengan format gambar yang diklaim.");
  }

  const extension = MIME_EXTENSIONS[file.type];
  const filename = `${randomUUID()}.${extension}`;
  const dir = path.join(process.cwd(), "public", "uploads", folder);
  await mkdir(dir, { recursive: true });

  await writeFile(path.join(dir, filename), buffer);

  return `/uploads/${folder}/${filename}`;
}
