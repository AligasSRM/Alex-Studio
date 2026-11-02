# Alex Studio Android companion

The Android companion is a native Android shell around the existing Alex Studio web workspace. It is designed for a Samsung Android phone and includes a native connection/retry screen, loading state, back navigation, launcher icon, and a restricted WebView network surface.

**Architecture:** this is a phone companion, not a standalone/offline port. The Next.js server, project files, backups, Groq credentials, and Docker-based execution remain on the trusted computer. The phone connects through an explicit USB ADB reverse tunnel. No public hosting or API-key embedding is introduced.

## Build and download

The GitHub Actions workflow `Android companion APK` builds a debug APK from `android-companion/` and uploads it as the `alex-studio-android-debug` artifact. Debug builds are for device testing, not Play Store release. Download the artifact ZIP from the successful workflow run, extract it, then install `app-debug.apk`.

## Connect a Samsung Android phone

1. Start Alex Studio on the trusted computer at `127.0.0.1:3000`.
2. Enable Developer options and USB debugging on the phone, connect it to the computer, and approve the debugging prompt.
3. Install Android Platform Tools (ADB) on the computer.
4. Confirm the phone is visible with `adb devices`.
5. Run `adb reverse tcp:3000 tcp:3000`.
6. Install the APK with `adb install -r app-debug.apk`, or open the APK on the phone and approve installation from that source.
7. Open Alex Studio. The app connects to `127.0.0.1:3000` through the USB reverse tunnel.

If the app shows its connection screen, confirm that the computer server is running, the USB debugging prompt was accepted, and `adb reverse` completed successfully; then tap **إعادة المحاولة**.

## Security boundaries

- WebView navigation and network resource requests are limited to HTTP loopback hosts on port 3000.
- File/content access, mixed content, pop-up windows, geolocation, and automatic media playback are disabled.
- TLS certificate errors are rejected.
- API keys remain on the computer-side server and must never be embedded in the APK.
- Keep the computer and phone physically controlled. The USB reverse tunnel is intended for a directly connected device and is not public hosting.

## Current limitations / acceptance still required

- The computer must remain on and connected by USB while using this companion.
- Project files and backups remain on the computer.
- Docker-based build, preview, and verification run on the computer, not on Android.
- CI APK build success does not prove installation or runtime behavior on a physical phone. Device-level smoke testing on the target Samsung device is still required.
- This is not a standalone APK with an on-device Node.js backend. A true on-device port requires a separate architecture project and replacement of host filesystem and Docker-dependent execution services.
