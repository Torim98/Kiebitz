import { describe, expect, it } from "vitest";
import { encodeShare } from "./codec";
import { firstSharePayload, parseShareLink, shareDeepLink, shareUrl } from "./link";

const FEN = "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3";
const payload = { kind: "analysis" as const, fen: FEN, orientation: "white" as const };
const encoded = encodeShare(payload);

describe("share links", () => {
  it("builds a web address and a deep link from the same payload", () => {
    expect(shareUrl(payload)).toBe(`https://s.kiebitz.dev/p/${encoded}`);
    expect(shareDeepLink(payload)).toBe(`kiebitz://p/${encoded}`);
  });

  it("reads its own links back", () => {
    expect(parseShareLink(shareUrl(payload))?.fen).toBe(FEN);
    expect(parseShareLink(shareDeepLink(payload))?.fen).toBe(FEN);
  });

  it("tolerates the trailing slash and a tracking suffix", () => {
    expect(parseShareLink(`kiebitz://p/${encoded}/`)?.fen).toBe(FEN);
    expect(parseShareLink(`https://s.kiebitz.dev/p/${encoded}?utm_source=chat`)?.fen).toBe(FEN);
    expect(parseShareLink(`  https://s.kiebitz.dev/p/${encoded}  `)?.fen).toBe(FEN);
  });

  it("takes the bare payload from the clipboard", () => {
    expect(parseShareLink(encoded)?.fen).toBe(FEN);
  });

  it("refuses links that are not ours", () => {
    expect(parseShareLink(`https://lichess.org/p/${encoded}`)).toBeNull();
    expect(parseShareLink(`https://kiebitz.dev.evil.example/p/${encoded}`)).toBeNull();
    expect(parseShareLink("kiebitz://auth?code=abcdefghijklmnop")).toBeNull();
    expect(parseShareLink("https://kiebitz.dev/")).toBeNull();
    expect(parseShareLink("")).toBeNull();
  });

  it("picks the first usable payload out of a list of urls", () => {
    expect(firstSharePayload(["kiebitz://open/?page=study", shareDeepLink(payload)])?.fen).toBe(FEN);
    expect(firstSharePayload(["kiebitz://auth/?code=abcdefghijklmnop"])).toBeNull();
    expect(firstSharePayload(null)).toBeNull();
  });
});
