# Alex Studio Android companion

This first Android package is a **phone companion**, not a standalone/offline port of the Next.js server. The existing application stores project files on the machine running its Node.js server, and its local-request security checks intentionally accept loopback hosts only. Docker-based project execution also remains on that host.

## Build

The GitHub Actions workflow `Android companion APK` builds a debug APK from `android-companion/` and uploads it as the `alex-studio-android-debug` artifact. This debug APK is for testing, not Play Store release.

## Connect a Samsung Android phone

1. Start Alex Studio on the trusted computer at `127.0.0.1:3000`.
2. Enable Developer options and USB debugging on the phone, then connect it to the computer and approve the debugging prompt.
3. Install Android Platform Tools (ADB) on the computer.
4. Run `adb reverse tcp:3000 tcp:3000`.
5. Install the APK artifact and open Alex Studio. The app connects to `127.0.0.1:3000` through the USB reverse tunnel.

The reverse tunnel is local to the USB-connected device and does not expose the app to the public internet or require changing the existing localhost-only API checks. Keep the computer and phone physically controlled. Do not add API keys to the Android app; Groq credentials remain on the server host.

## Current limitations

- The computer must remain on and connected by USB while using this companion.
- Project files and backups remain on the computer.
- Docker-based build/preview/verification runs on the computer, not on Android.
- This is not a standalone APK with an on-device Node.js backend. A true on-device port requires a separate architecture project and replacement of host filesystem and Docker-dependent execution services.
