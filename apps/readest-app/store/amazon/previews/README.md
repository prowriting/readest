# Tablet screenshot previews

These 1600×2560 PNGs were captured from BookArc's existing Playwright store harness
with `NEXT_PUBLIC_DIST_CHANNEL=amazon`, using its fictional/rights-cleared sample content:

```sh
NEXT_PUBLIC_DIST_CHANNEL=amazon PLAYWRIGHT_PORT=3017 pnpm store:capture --project=tablet7 --grep '02 library|04 reading|05 discover'
```

All three capture tests passed, and the images were visually reviewed. They show the web
renderer at a tablet viewport. They are **not screenshots from a Fire tablet**, and do not
prove Fire OS compatibility. Capture the corresponding screens on the tested release APK
using `pnpm amazon:screenshot` before final submission. Amazon's supported tablet screenshot
sizes include 1600×2560 in portrait orientation.
