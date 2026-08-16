// @vitest-environment node
/**
 * Deep Links kommen von außen · aus einer E-Mail und vom Startbildschirm.
 * Was hier durchkommt, löst eine Anmeldung aus oder springt in die App.
 */
import { describe, expect, it } from "vitest";
import { firstAuthCode, firstOpenPage, parseAuthDeepLink, parseOpenDeepLink } from "./deepLink";

describe("parseAuthDeepLink", () => {
  it("reads the one-time code out of the callback link", () => {
    expect(parseAuthDeepLink("kiebitz://auth?code=abcdef0123456789ABCDEF")).toBe(
      "abcdef0123456789ABCDEF"
    );
  });

  it("reads the code out of the form a browser hands over", () => {
    // Chromium kanonisiert `kiebitz://auth?code=…` zu `kiebitz://auth/?code=…`.
    // Genau diese Form kommt aus der E-Mail, und nur diese hatte nie geklappt.
    expect(parseAuthDeepLink("kiebitz://auth/?code=abcdef0123456789ABCDEF")).toBe(
      "abcdef0123456789ABCDEF"
    );
    expect(
      firstAuthCode(["kiebitz://auth/?code=abcdef0123456789ABCDEF"])
    ).toBe("abcdef0123456789ABCDEF");
  });

  it("ignores the pairing link that shares the same scheme", () => {
    expect(
      parseAuthDeepLink("kiebitz://sync?host=192.168.1.5:47323&code=123456&fingerprint=00")
    ).toBeNull();
  });

  it("rejects links without a usable code", () => {
    expect(parseAuthDeepLink("kiebitz://auth")).toBeNull();
    expect(parseAuthDeepLink("kiebitz://auth?code=")).toBeNull();
    expect(parseAuthDeepLink("kiebitz://auth?code=short")).toBeNull();
    expect(parseAuthDeepLink("https://api.kiebitz.dev/auth?code=abcdef0123456789ABCD")).toBeNull();
  });

  it("rejects a code with characters the API never issues", () => {
    expect(parseAuthDeepLink("kiebitz://auth?code=abcdef0123456789ABC$%")).toBeNull();
  });

  it("picks the first usable code from a batch of links", () => {
    expect(
      firstAuthCode(["kiebitz://sync?code=1", "kiebitz://auth?code=abcdef0123456789ABCDEF"])
    ).toBe("abcdef0123456789ABCDEF");
    expect(firstAuthCode([])).toBeNull();
    expect(firstAuthCode(null)).toBeNull();
  });
});

describe("parseOpenDeepLink", () => {
  it("maps a widget link to a page", () => {
    expect(parseOpenDeepLink("kiebitz://open?page=puzzles")).toBe("puzzles");
    expect(parseOpenDeepLink("kiebitz://open/?page=puzzles")).toBe("puzzles");
    expect(parseOpenDeepLink("kiebitz://open?page=settings&section=plus")).toBe("settings");
  });

  it("ignores unknown pages instead of navigating somewhere random", () => {
    expect(parseOpenDeepLink("kiebitz://open?page=admin")).toBeNull();
    expect(parseOpenDeepLink("kiebitz://open")).toBeNull();
    expect(parseOpenDeepLink("kiebitz://auth?code=abcdef0123456789ABCDEF")).toBeNull();
  });

  it("picks the first usable page from a batch of links", () => {
    expect(firstOpenPage(["kiebitz://open?page=nope", "kiebitz://open?page=study"])).toBe("study");
    expect(firstOpenPage(undefined)).toBeNull();
  });
});
