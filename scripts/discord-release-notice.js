// The Discord release announcement, built in one place and posted by two workflows.
//
// Shape copied from ValorantTweaks (.github/workflows/notify-discord-bot.yml): the
// message is NOT sent to a Discord webhook. It is POSTed to a Cloudflare Worker that
// re-sends it with a bot token, because `components` — the link buttons under the embed
// — are a bot-only feature. A webhook silently drops them, which is why the button row
// is the reason the relay exists at all.
//
// Why a module instead of ~90 lines of PowerShell inlined in each workflow, the way
// ValorantTweaks does it: over there the same payload is spelled out twice (release.yml
// and notify-discord-bot.yml) and the two copies have already drifted. Here the payload
// has one definition, the asset names come from scripts/release-naming.js rather than
// being retyped, and test/discord-notice.test.js pins the parts a user actually clicks.
//
// This module never sees the relay URL or its auth token. It prints JSON; the workflow
// holds the secrets and does the POST.

const { portableZipName, installerZipName, normalizeVersion } = require('./release-naming');

// Valorant red (#FF4655) as the decimal Discord expects.
const EMBED_COLOR = 0xff4655;
const LOGO_URL =
  'https://upload.wikimedia.org/wikipedia/commons/thumb/f/fc/Valorant_logo_-_pink_color_version.svg/2560px-Valorant_logo_-_pink_color_version.svg.png';
const RULE = '━'.repeat(42);

// A malformed dispatch input must fail here, not produce an announcement whose buttons
// 404. Both values end up inside URLs users click.
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
 * @param {{tag: string, repo: string, now?: Date}} input
 *   repo is the repository holding the RELEASE, which is not necessarily the repository
 *   the workflow runs in — see the RELEASE_REPO variable in the workflows.
 */
function buildReleaseNotice({ tag, repo, now } = {}) {
  const version = assertTag(tag);
  assertRepo(repo);

  const releaseUrl = `https://github.com/${repo}/releases/tag/v${version}`;
  const downloadBase = `https://github.com/${repo}/releases/download/v${version}`;
  const installerUrl = `${downloadBase}/${installerZipName(version)}`;
  const portableUrl = `${downloadBase}/${portableZipName(version)}`;

  return {
    embeds: [
      {
        title: `${RULE}\n      🎮  VALORANT SCORE ALERT — PHIÊN BẢN MỚI\n${RULE}`,
        url: releaseUrl,
        description: `✅  Phiên bản **Valorant Score Alert v${version}** đã sẵn sàng tải xuống!`,
        color: EMBED_COLOR,
        thumbnail: { url: LOGO_URL },
        fields: [
          { name: '📦  Phiên bản', value: `\`${version}\``, inline: true },
          { name: '💻  Nền tảng', value: 'Windows x64', inline: true },
          {
            // The installer path, not the portable one: this is what the Download button
            // on the dashboard serves (KLD resolves recommended = installer ?? portable),
            // so the instructions have to match the file most people end up with.
            name: '● HƯỚNG DẪN CÀI ĐẶT',
            value: [
              '1️⃣  Tải **bộ cài** bằng button bên dưới.',
              '2️⃣  Chuột phải vào file ZIP → **Properties** → tích **Unblock** → **OK**.',
              '3️⃣  Giải nén **TOÀN BỘ** file ZIP ra một thư mục bình thường (ví dụ Desktop).',
              '4️⃣  Bấm đúp `Install-ValorantAlert.cmd` rồi chờ dòng `[OK] Hoan tat`.',
              '5️⃣  Mở **Valorant Score Alert** từ shortcut Desktop hoặc Start Menu.',
              '6️⃣  Icon hình khiên xuất hiện ở khay hệ thống — chuột phải vào đó để mở Dashboard.',
              '',
              '⚠️  Không chạy trực tiếp bên trong file ZIP: bộ cài sẽ không thấy payload.'
            ].join('\n\n'),
            inline: false
          },
          {
            name: '● LƯU Ý',
            value: [
              'Nếu Windows SmartScreen xuất hiện, chọn **More info** → **Run anyway**. App chưa được ký số nên đây là chuyện bình thường.',
              'Cài cho riêng user đang đăng nhập, vào `%LOCALAPPDATA%\\Programs\\ValorantAlert` — **không cần quyền admin, không có UAC**.',
              'Nâng cấp thì chạy lại bộ cài: nó tự dừng bản đang chạy và thay toàn bộ thư mục.',
              'Dữ liệu đăng nhập / license nằm ở `%APPDATA%\\ValorantAlert` và **không bị xoá** khi gỡ cài đặt.'
            ].join('\n\n'),
            inline: false
          }
        ],
        footer: { text: 'Valorant Score Alert Release System', icon_url: LOGO_URL },
        // Injected so a test can assert a fixed payload; defaults to send time.
        timestamp: (now || new Date()).toISOString()
      }
    ],
    // type 1 = action row, type 2 = button, style 5 = link. Link buttons carry no
    // custom_id and need no interaction handler — nothing has to stay running to serve
    // them, which is what makes this safe to fire from CI and forget.
    components: [
      {
        type: 1,
        components: [
          { type: 2, style: 5, label: '⬇️  Tải bộ cài (khuyên dùng)', url: installerUrl },
          { type: 2, style: 5, label: '📁  Bản portable', url: portableUrl },
          { type: 2, style: 5, label: '📄  Release Notes', url: releaseUrl }
        ]
      }
    ]
  };
}

module.exports = { buildReleaseNotice, EMBED_COLOR, LOGO_URL };

// CLI: node scripts/discord-release-notice.js --tag v1.0.0 --repo 103PU/Valorant-Alert-Source
//      [--out notice.json] [--pretty]
//
// --out writes UTF-8 bytes straight to disk so the workflow can POST those bytes without
// a single string round-trip. The payload is Vietnamese plus emoji, and a shell that
// re-encodes it — Windows PowerShell 5.1 defaults to ASCII for some content types — sends
// Discord a message full of '?'. Bytes in, bytes out, no encoding to get wrong.
// Errors go to stderr with exit 1, so a bad input fails the step instead of sending a
// half-built message.
if (require.main === module) {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const at = argv.indexOf(`--${name}`);
    return at === -1 ? undefined : argv[at + 1];
  };

  try {
    const notice = buildReleaseNotice({ tag: flag('tag'), repo: flag('repo') });
    const json = JSON.stringify(notice, null, argv.includes('--pretty') ? 2 : 0);
    const out = flag('out');

    if (out) {
      require('fs').writeFileSync(out, Buffer.from(json, 'utf8'));
      process.stdout.write(`wrote ${Buffer.byteLength(json, 'utf8')} bytes to ${out}\n`);
    } else {
      process.stdout.write(json);
    }
  } catch (err) {
    process.stderr.write(`discord-release-notice: ${err.message}\n`);
    process.exit(1);
  }
}
