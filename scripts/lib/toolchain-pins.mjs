import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const pinsPath = join(repoRoot, "config", "toolchain-pins.json");

export function loadToolchainPins() {
  const pins = JSON.parse(readFileSync(pinsPath, "utf8"));
  const sha256 = /^[a-f0-9]{64}$/;
  const commit = /^[a-f0-9]{40}$/;
  if (!/^\d+$/.test(pins.stockfish.version)) throw new Error("Invalid Stockfish version pin");
  if (!commit.test(pins.stockfish.commit)) throw new Error("Invalid Stockfish commit pin");
  if (!/^https:\/\//.test(pins.stockfish.repository)) throw new Error("Invalid Stockfish repository");
  if (!sha256.test(pins.stockfish.windowsArchive.sha256)) throw new Error("Invalid Windows archive SHA-256");
  for (const network of pins.stockfish.networks) {
    if (!sha256.test(network.sha256)) throw new Error(`Invalid NNUE SHA-256 for ${network.file}`);
  }
  for (const key of ["compileSdk", "targetSdk", "minSdk", "nativeApi", "pageSize"]) {
    if (!Number.isInteger(pins.android[key]) || pins.android[key] <= 0) {
      throw new Error(`Invalid Android pin: ${key}`);
    }
  }
  return pins;
}

export function pinEnvironment(pins = loadToolchainPins()) {
  const tag = `sf_${pins.stockfish.version}`;
  const sourceAsset = `stockfish-${pins.stockfish.version}-source-${pins.stockfish.commit.slice(0, 12)}.tar.gz`;
  const windowsUrl = `${pins.stockfish.repository}/releases/download/${tag}/${pins.stockfish.windowsArchive.name}`;
  return {
    STOCKFISH_VERSION: pins.stockfish.version,
    STOCKFISH_TAG: tag,
    STOCKFISH_COMMIT: pins.stockfish.commit,
    STOCKFISH_GIT_DATE: pins.stockfish.gitDate,
    STOCKFISH_REPOSITORY: pins.stockfish.repository,
    STOCKFISH_SOURCE_ASSET: sourceAsset,
    STOCKFISH_WINDOWS_ARCHIVE: pins.stockfish.windowsArchive.name,
    STOCKFISH_WINDOWS_URL: windowsUrl,
    STOCKFISH_WINDOWS_SHA256: pins.stockfish.windowsArchive.sha256,
    ANDROID_COMPILE_SDK: String(pins.android.compileSdk),
    ANDROID_TARGET_SDK: String(pins.android.targetSdk),
    ANDROID_MIN_SDK: String(pins.android.minSdk),
    ANDROID_NATIVE_API: String(pins.android.nativeApi),
    ANDROID_BUILD_TOOLS: pins.android.buildTools,
    ANDROID_NDK_VERSION: pins.android.ndk,
    ANDROID_PAGE_SIZE: String(pins.android.pageSize),
  };
}
