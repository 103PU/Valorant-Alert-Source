const { portableZipName, setupExeName, normalizeVersion } = require('./release-naming');

const EMBED_COLOR = 0xff4655;

const LOGO_URL =
  'https://upload.wikimedia.org/wikipedia/commons/thumb/f/fc/Valorant_logo_-_pink_color_version.svg/2560px-Valorant_logo_-_pink_color_version.svg.png';

const RULE = '━'.repeat(42);

function assertRepo(repo) {
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(String(repo || ''))) {
    throw new Error(`repo must be owner/name, got '${repo}'`);
  }

  return repo;
}

function assertTag(tag) {
  const version = normalizeVersion(tag);

  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`tag must be vX.Y.Z, got '${tag}'`);
  }

  return version;
}

/**
 * Build the Discord release announcement.
 *
 * @param {{tag: string, repo: string, now?: Date}} input
 */
function buildReleaseNotice({ tag, repo, now } = {}) {
  const version = assertTag(tag);
  assertRepo(repo);

  const releaseUrl =
    `https://github.com/${repo}/releases/tag/v${version}`;

  const downloadBase =
    `https://github.com/${repo}/releases/download/v${version}`;

  const setupUrl =
    `${downloadBase}/${setupExeName(version)}`;

  const portableUrl =
    `${downloadBase}/${portableZipName(version)}`;

  return {
    embeds: [
      {
        title:
          `${RULE}\n` +
          `      🎮  VALORANT SCORE ALERT — PHIÊN BẢN MỚI\n` +
          `${RULE}`,

        url: releaseUrl,

        description:
          `✅  Phiên bản **Valorant Score Alert v${version}** đã sẵn sàng tải xuống!`,

        color: EMBED_COLOR,

        thumbnail: {
          url: LOGO_URL
        },

        fields: [
          {
            name: '📦  Phiên bản',
            value: `\`${version}\``,
            inline: true
          },
          {
            name: '💻  Nền tảng',
            value: 'Windows x64',
            inline: true
          },
          {
            name: '● HƯỚNG DẪN CÀI ĐẶT',
            value: [
              '1️⃣  Tải file **Setup (.exe)** bằng button bên dưới.',
              '2️⃣  Mở file `.exe` để cài đặt.',
              '3️⃣  Mở **Valorant Score Alert** từ Desktop hoặc Start Menu.'
            ].join('\n\n'),
            inline: false
          },
          {
            name: '● LƯU Ý',
            value:
              'Nếu Windows SmartScreen xuất hiện, chọn **Thông tin thêm** → **Vẫn chạy**.\n' +
              'Điều này xảy ra do app chưa được ký số.',
            inline: false
          }
        ],

        footer: {
          text: 'Valorant Score Alert Release System',
          icon_url: LOGO_URL
        },

        timestamp: (now || new Date()).toISOString()
      }
    ],

    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 5,
            label: '⬇️  Tải Setup (.exe)',
            url: setupUrl
          },
          {
            type: 2,
            style: 5,
            label: '📦  Bản Portable (ZIP)',
            url: portableUrl
          },
          {
            type: 2,
            style: 5,
            label: '📄  Release Notes',
            url: releaseUrl
          }
        ]
      }
    ]
  };
}

module.exports = {
  buildReleaseNotice,
  EMBED_COLOR,
  LOGO_URL
};

// CLI:
// node scripts/discord-release-notice.js
//   --tag v1.0.0
//   --repo 103PU/Valorant-Alert-Source
//   [--out notice.json]
//   [--pretty]

if (require.main === module) {
  const argv = process.argv.slice(2);

  const flag = (name) => {
    const index = argv.indexOf(`--${name}`);
    return index === -1 ? undefined : argv[index + 1];
  };

  try {
    const notice = buildReleaseNotice({
      tag: flag('tag'),
      repo: flag('repo')
    });

    const json = JSON.stringify(
      notice,
      null,
      argv.includes('--pretty') ? 2 : 0
    );

    const out = flag('out');

    if (out) {
      require('fs').writeFileSync(
        out,
        Buffer.from(json, 'utf8')
      );

      process.stdout.write(
        `wrote ${Buffer.byteLength(json, 'utf8')} bytes to ${out}\n`
      );
    } else {
      process.stdout.write(json);
    }
  } catch (err) {
    process.stderr.write(
      `discord-release-notice: ${err.message}\n`
    );

    process.exit(1);
  }
}
