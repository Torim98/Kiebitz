import assert from "node:assert/strict";
import test from "node:test";
import { buildUpdaterManifest, findSignature } from "./lib/updater-manifest.mjs";

const assets = [
  { id: 1, name: "Kiebitz.msi" },
  { id: 2, name: "Kiebitz.msi.sig" },
  { id: 3, name: "Kiebitz-setup.exe" },
  { id: 4, name: "Kiebitz-setup.exe.sig" },
  { id: 5, name: "Kiebitz.app.tar.gz" },
  { id: 6, name: "Kiebitz.app.tar.gz.sig" },
  { id: 7, name: "Kiebitz.AppImage" },
  { id: 8, name: "Kiebitz.AppImage.sig" },
];

test("builds the complete updater manifest with encoded asset URLs", async () => {
  const manifest = await buildUpdaterManifest({
    release: { body: "Release notes" },
    assets,
    repository: "kiebitz-dev/Kiebitz",
    serverUrl: "https://github.com",
    tag: "v1.0 beta",
    version: "1.0.0",
    readSignature: async (asset) => `signature-${asset.id}`,
    now: () => new Date("2026-08-12T10:00:00.000Z"),
  });

  assert.equal(manifest.version, "1.0.0");
  assert.equal(manifest.notes, "Release notes");
  assert.equal(manifest.pub_date, "2026-08-12T10:00:00.000Z");
  assert.equal(manifest.platforms["windows-x86_64"].signature, "signature-2");
  assert.match(manifest.platforms["windows-x86_64"].url, /v1\.0%20beta\/Kiebitz\.msi$/);
  assert.strictEqual(
    manifest.platforms["windows-x86_64"],
    manifest.platforms["windows-x86_64-msi"],
  );
  assert.equal(Object.keys(manifest.platforms).length, 7);
});

test("rejects ambiguous signatures", () => {
  assert.throws(
    () => findSignature(
      [{ name: "one.msi.sig" }, { name: "two.msi.sig" }],
      "Windows MSI",
      [".msi.sig"],
    ),
    /mehrere Signaturen/,
  );
});

test("rejects a signature without its bundle", async () => {
  await assert.rejects(
    buildUpdaterManifest({
      release: {},
      assets: assets.filter((asset) => asset.name !== "Kiebitz.msi"),
      repository: "kiebitz-dev/Kiebitz",
      serverUrl: "https://github.com",
      tag: "v1.0.0",
      version: "1.0.0",
      readSignature: async () => "signature",
    }),
    /Bundle Kiebitz\.msi zur Signatur fehlt/,
  );
});
