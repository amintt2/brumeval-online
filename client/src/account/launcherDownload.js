// [accounts] "Télécharger le launcher" card: which installer to offer for this OS. The file names follow
// launcher/electron-builder.yml exactly (artifactName of nsis / dmg / appImage) with the launcher version of
// this build; they are served by the latest GitHub release of the repository.
/* global __LAUNCHER_VERSION__ */

export const RELEASES_URL = 'https://github.com/amintt2/brumeval-online/releases';
export const LATEST_DOWNLOAD = `${RELEASES_URL}/latest/download`;
export const LAUNCHER_VERSION = typeof __LAUNCHER_VERSION__ === 'string' ? __LAUNCHER_VERSION__ : '0.2.0';

/**
 * Installer(s) for an OS.
 * @param {'windows'|'mac'|'linux'|'other'} os
 * @returns {{ os, label, files: { name, url, label }[] }}
 */
export function launcherDownloads(os, version = LAUNCHER_VERSION) {
  const file = (name, label) => ({ name, url: `${LATEST_DOWNLOAD}/${name}`, label });
  switch (os) {
    case 'windows':
      return { os, label: 'Windows', files: [file(`Brumeval-Launcher-Setup-${version}.exe`, 'Windows (.exe)')] };
    case 'mac':
      return {
        os, label: 'macOS',
        files: [
          file(`Brumeval-Launcher-${version}-mac-arm64.dmg`, 'macOS Apple Silicon (.dmg)'),
          file(`Brumeval-Launcher-${version}-mac-x64.dmg`, 'macOS Intel (.dmg)'),
        ],
      };
    case 'linux':
      // electron-builder names the x64 AppImage "x86_64"
      return { os, label: 'Linux', files: [file(`Brumeval-Launcher-${version}-linux-x86_64.AppImage`, 'Linux (AppImage)')] };
    default:
      return { os: 'other', label: '', files: [] };
  }
}

/** OS of this browser (userAgentData when available, user agent otherwise). Phones and tablets: 'other'. */
export function detectOs(nav = typeof navigator !== 'undefined' ? navigator : {}) {
  const ua = nav.userAgent || '';
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return 'other';
  const p = (nav.userAgentData?.platform || nav.platform || '').toLowerCase();
  if (p.includes('win') || /Windows/.test(ua)) return 'windows';
  if (p.includes('mac') || /Mac OS X|Macintosh/.test(ua)) return (nav.maxTouchPoints || 0) > 1 ? 'other' : 'mac'; // iPadOS says "Mac"
  if (p.includes('linux') || /Linux|X11/.test(ua)) return 'linux';
  return 'other';
}
