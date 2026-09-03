// The canonical origin, used by metadataBase, the sitemap and robots.txt.
// Every marketing URL is written relative to this — never hardcode the host again.
export const SITE_URL = 'https://www.possiblle.com';

// Where /yukle sends a restaurant for the Windows installer.
//
// The .exe is built by .github/workflows/desktop.yml and attached to a GitHub
// Release when a v* tag is pushed. This is the "latest" address: it resolves to
// whichever release is newest, so publishing a new version needs no change here
// — which is also why package.json's artifactName carries no version number.
export const DESKTOP_DOWNLOAD_URL =
  'https://github.com/kamranhajiyev/restoran-app/releases/latest/download/PossibllePOS-Setup.exe';

// Shown beside the button so the owner knows what they are about to get.
// Update alongside the URL when a new installer is published.
export const DESKTOP_VERSION = '0.1.0';
