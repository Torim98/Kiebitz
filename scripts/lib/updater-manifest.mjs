const PLATFORM_ASSETS = {
  windowsMsi: [".msi.sig", ".msi.zip.sig"],
  windowsNsis: [".exe.sig", ".nsis.zip.sig"],
  macos: [".app.tar.gz.sig"],
  linux: [".AppImage.sig", ".AppImage.tar.gz.sig"],
};

export function findSignature(assets, label, suffixes) {
  for (const suffix of suffixes) {
    const matches = assets.filter((asset) => asset.name.endsWith(suffix));
    if (matches.length > 1) {
      throw new Error(`${label}: mehrere Signaturen mit Endung ${suffix}`);
    }
    if (matches.length === 1) return matches[0];
  }
  throw new Error(`${label}: keine Signatur (${suffixes.join(" oder ")}) gefunden`);
}

function downloadUrl(serverUrl, repository, tag, assetName) {
  return `${serverUrl}/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(assetName)}`;
}

export async function buildUpdaterManifest({
  release,
  assets,
  repository,
  serverUrl,
  tag,
  version,
  readSignature,
  now = () => new Date(),
}) {
  if (!release || !Array.isArray(assets) || !repository || !serverUrl || !tag || !version) {
    throw new Error("Release-Metadaten fehlen.");
  }

  const updaterEntry = async (label, suffixes) => {
    const signatureAsset = findSignature(assets, label, suffixes);
    const bundleName = signatureAsset.name.slice(0, -".sig".length);
    const bundleAsset = assets.find((asset) => asset.name === bundleName);
    if (!bundleAsset) throw new Error(`${label}: Bundle ${bundleName} zur Signatur fehlt`);
    return {
      signature: await readSignature(signatureAsset),
      url: downloadUrl(serverUrl, repository, tag, bundleAsset.name),
    };
  };

  const [windowsMsi, windowsNsis, macos, linux] = await Promise.all([
    updaterEntry("Windows MSI", PLATFORM_ASSETS.windowsMsi),
    updaterEntry("Windows NSIS", PLATFORM_ASSETS.windowsNsis),
    updaterEntry("macOS", PLATFORM_ASSETS.macos),
    updaterEntry("Linux AppImage", PLATFORM_ASSETS.linux),
  ]);

  return {
    version,
    notes: release.body ?? "",
    pub_date: now().toISOString(),
    platforms: {
      "windows-x86_64": windowsMsi,
      "windows-x86_64-msi": windowsMsi,
      "windows-x86_64-nsis": windowsNsis,
      "darwin-aarch64": macos,
      "darwin-aarch64-app": macos,
      "linux-x86_64": linux,
      "linux-x86_64-appimage": linux,
    },
  };
}
