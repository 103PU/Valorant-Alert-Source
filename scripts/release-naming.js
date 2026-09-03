// Release artifact naming — the contract KLD's download resolver matches on.
//
// KLD picks the download for /api/applications/.../download by scanning the
// GitHub release's assets, lowercasing each name and testing:
//
//   portable  : name.endsWith('.zip') && name.includes('win-x64') && !name.includes('installer')
//   installer : name.endsWith('.zip') && name.includes('win-x64') &&  name.includes('installer')
//   checksums : name === 'sha256sums.txt'
//
// (Keylicensedashboard/worker/domains/applications/download-resolver.ts:88-101.)
// A bare ValorantScoreAlert.exe — what this build used to emit — matches none of
// them, so the resolver returned null and the dashboard's download button was a
// dead end no matter how the release was tagged. The naming below is therefore
// load-bearing, not cosmetic: rename these and the funnel breaks silently.
//
// Two further conditions live on the release rather than the file, and are
// asserted in .github/workflows/release.yml instead: the release must not be a
// draft or a prerelease, and each asset must reach state === 'uploaded'.

const PLATFORM_TAG = 'win-x64';
const CHECKSUM_FILE = 'SHA256SUMS.txt';

/** dist/ValorantScoreAlert-v1.0.0-win-x64.zip */
function portableZipName(version) {
  return `ValorantScoreAlert-v${normalizeVersion(version)}-${PLATFORM_TAG}.zip`;
}

/** Reserved for the installer artifact; 'installer' is what selects it at KLD. */
function installerZipName(version) {
  return `ValorantScoreAlert-v${normalizeVersion(version)}-${PLATFORM_TAG}-installer.zip`;
}

function checksumFileName() {
  return CHECKSUM_FILE;
}

function normalizeVersion(version) {
  return String(version || '0.0.0').trim().replace(/^v/i, '');
}

// Mirrors the resolver's own predicates so a test can prove the names we emit
// are the names it will accept, without reaching into the KLD repo at runtime.
const resolver = {
  isZip: (name) => String(name).toLowerCase().endsWith('.zip'),
  isThisPlatform: (name) => String(name).toLowerCase().includes(PLATFORM_TAG),
  isInstaller: (name) => String(name).toLowerCase().includes('installer'),
  isChecksums: (name) => String(name).toLowerCase() === CHECKSUM_FILE.toLowerCase(),
  matchesPortable(name) {
    return this.isZip(name) && this.isThisPlatform(name) && !this.isInstaller(name);
  },
  matchesInstaller(name) {
    return this.isZip(name) && this.isThisPlatform(name) && this.isInstaller(name);
  }
};

/** `sha256sum` output format: 64 hex, two spaces, filename. */
function checksumLine(hex, fileName) {
  return `${hex}  ${fileName}`;
}

module.exports = {
  PLATFORM_TAG,
  portableZipName,
  installerZipName,
  checksumFileName,
  normalizeVersion,
  checksumLine,
  resolver
};
