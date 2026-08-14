# Advertising

Kiebitz has one shared banner position in the Free UI. Android renders a native
Google Mobile Ads banner over that position. Desktop embeds a static campaign
surface served from the Kiebitz website. No Kiebitz application server is
required for either integration.

## Android

Debug builds always use Google's published sample app ID and fixed banner test
ID. They do not generate revenue and are safe for development.

Release builds use Kiebitz' production IDs:

```text
App:    ca-app-pub-9343669245707846~7313498282
Banner: ca-app-pub-9343669245707846/9496808496
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

The shared UI slot starts at zero height. The native container stays hidden
while consent and the ad request are pending; only `AdListener.onAdLoaded`
expands the slot to 50 px. `onAdFailedToLoad` (including no-fill responses)
keeps it collapsed, so unavailable inventory never leaves an empty strip.

## Desktop

Google AdSense may not be embedded in desktop software. Kiebitz therefore uses
neither AdSense nor the Android SDK on desktop. A sandboxed frame loads the
static campaign surface from:

```text
https://kiebitz.dev/desktop-ad/
```

The frame is sandboxed, receives no referrer, and is not passed chess data, a
Kiebitz user identifier, cookies, or an advertising ID. Campaign creatives are
served from the same website origin. External destinations open in the system
browser only after an explicit click. If the page is unavailable or reports no
active campaign, Kiebitz collapses the slot.

Campaigns are maintained in the website repository under
`src/desktop-ad/campaigns.json`. They support activation, start and end dates,
relative weights, localized copy, and a same-origin image. Updating or rotating
a campaign requires only a website deployment, not a new Kiebitz release.

The frame URL can be overridden or explicitly disabled for special builds:

```text
VITE_DESKTOP_AD_FRAME_URL=https://example.invalid/custom-surface/
VITE_DESKTOP_AD_FRAME_URL=
```

The static surface intentionally has no cookies, browser storage, analytics,
remote scripts, or passive third-party resources. GitHub Pages still receives
technically necessary connection data when serving the files; this is disclosed
in the public privacy policy.
