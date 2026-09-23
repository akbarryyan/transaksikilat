import { unlink } from "fs/promises";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sessionState = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("@/lib/session", () => ({
  getSession: async () => sessionState.current,
}));

import { POST as upload } from "@/app/api/upload/route";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

const writtenPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    writtenPaths
      .splice(0)
      .map((p) => unlink(path.join(process.cwd(), "public", p)).catch(() => {}))
  );
});

function pngFile(): File {
  return new File([new Uint8Array(PNG_BYTES)], "gambar.png", { type: "image/png" });
}

function uploadRequest(folder: string, file: File = pngFile()): Request {
  const form = new FormData();
  form.append("file", file);
  form.append("folder", folder);
  return new Request("http://localhost/api/upload", { method: "POST", body: form });
}

async function send(folder: string, file?: File) {
  const res = await upload(uploadRequest(folder, file));
  const body = await res.json();
  if (body?.data?.url) writtenPaths.push(body.data.url);
  return { status: res.status, body };
}

function signInAs(role: "MEMBER" | "ADMIN") {
  sessionState.current = { isLoggedIn: true, userId: `user-${role}`, role };
}

describe("upload authorization", () => {
  beforeEach(() => {
    sessionState.current = {};
  });

  it("refuses a caller who is not signed in", async () => {
    const { status } = await send("sellers");

    expect(status).toBe(401);
  });

  it("refuses a destination folder that is not on the list", async () => {
    // The folder becomes a path segment, so an open one is a directory to
    // write into anywhere under public/.
    signInAs("MEMBER");

    expect((await send("../../etc")).status).toBe(400);
    expect((await send("avatars")).status).toBe(400);
    expect((await send("")).status).toBe(400);
  });

  it("refuses a member writing into a folder reserved for admins", async () => {
    // These folders feed the storefront: banners, promos, payment method logos.
    signInAs("MEMBER");

    for (const folder of ["promos", "brands", "banners", "payment-methods", "site", "footer"]) {
      expect((await send(folder)).status, `${folder} should be admin-only`).toBe(403);
    }
  });

  it("lets a member write into the folder meant for merchants", async () => {
    signInAs("MEMBER");

    const { status, body } = await send("sellers");

    expect(status).toBe(200);
    expect(body.data.url).toMatch(/^\/uploads\/sellers\/[\w-]+\.png$/);
  });

  it("lets an admin write into a storefront folder", async () => {
    signInAs("ADMIN");

    const { status, body } = await send("promos");

    expect(status).toBe(200);
    expect(body.data.url).toMatch(/^\/uploads\/promos\/[\w-]+\.png$/);
  });

  it("refuses content that does not match the image type it claims", async () => {
    signInAs("MEMBER");
    const disguised = new File(
      [new TextEncoder().encode("<script>alert(document.cookie)</script>")],
      "gambar.png",
      { type: "image/png" }
    );

    const { status } = await send("sellers", disguised);

    expect(status).toBe(400);
  });

  it("names the stored file itself rather than trusting the one supplied", async () => {
    // A caller-supplied name is how an upload ends up overwriting something or
    // carrying an extension the folder is not meant to hold.
    signInAs("MEMBER");
    const named = new File([new Uint8Array(PNG_BYTES)], "../../evil.php", { type: "image/png" });

    const { status, body } = await send("sellers", named);

    expect(status).toBe(200);
    expect(body.data.url).not.toContain("evil");
    expect(body.data.url).not.toContain("..");
    expect(body.data.url.endsWith(".png")).toBe(true);
  });
});
