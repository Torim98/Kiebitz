# Advertising

Kiebitz has one shared banner position in the Free UI. Android renders a native
Google Mobile Ads banner over that position. Desktop embeds an HTTPS frame only
when a provider that explicitly permits ads in installed desktop software has
been configured. No Kiebitz server is required for the Android integration.

## Android

Debug builds always use Google's published sample app ID and fixed banner test
ID. They do not generate revenue and are safe for development.

Release builds use Kiebitz' production IDs:

```text
App:    ca-app-pub-9343669245707846~1360316109
Banner: ca-app-pub-9343669245707846/3667181173
```

The release IDs can be overridden as environment variables:

```text
KIEBITZ_ADMOB_APP_ID=ca-app-pub-…~…
KIEBITZ_ADMOB_BANNER_ID=ca-app-pub-…/…
```

or as Gradle properties:

```text
kiebitz.admob.appId=ca-app-pub-…~…
kiebitz.admob.bannerId=ca-app-pub-…/…
```

Before publishing a build with production IDs:

1. Create the app and banner unit in AdMob.
2. Create and publish the required European regulations message under
   **Privacy & messaging** in AdMob. The app uses Google's UMP SDK and requests
   consent before initializing or requesting an ad.
3. Update the public privacy policy and the Play Console **Data safety** and
   **Contains ads** declarations for the exact AdMob configuration in use.
4. Verify test traffic with the sample IDs first. Never click production ads
   during testing.

Users can reopen UMP's privacy choices in **Settings → Ads & privacy** whenever
Google reports that a privacy-options entry point is required.

## Desktop

Google AdSense may not be embedded in desktop software. Consequently Kiebitz
does not ship an AdSense snippet or silently reuse the Android provider. A
release stays ad-free until an approved provider supplies an HTTPS creative or
publisher-frame endpoint:

```text
VITE_DESKTOP_AD_FRAME_URL=https://approved-provider.example/kiebitz-banner
```

The frame is sandboxed, receives no referrer, and is not passed chess data or a
Kiebitz user identifier. The provider endpoint must handle any consent UI it
requires and must contractually permit use inside Windows, macOS, and Linux
desktop applications. A static hosted frame can be deployed with the existing
website; it does not require a continuously running custom backend.

In development, the desktop UI shows a labelled placeholder when no URL is set.
Production builds collapse the slot completely in that case.

## Free and Plus

`AdBanner` accepts a `free` flag. Setting it to `false` removes the desktop
frame and tells Android to hide and stop the native banner. The entitlement
source is intentionally not implemented here; it will be connected when
Kiebitz Plus billing is added.
