const { getAuthData } = require('../riot/riot-auth');
const { getRegionInfo } = require('../riot/riot-region');
const { evaluateAlertStatus } = require('./alert-rules');
const logger = require('../utils/logger');

const CLIENT_PLATFORM_BASE64 = 'ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQ0LjEuMjU2LjEuNTEyLjE1IiwNCgkicGxhdGZvcm1WYWx1ZSI6ICJidWlsZC0xMTQ4NzQ3LWxpc3QiDQp9';

// Valorant Unreal Engine Map Asset Dictionary
const VALORANT_MAP_NAMES = {
  '/Game/Maps/Ascent/Ascent': 'ASCENT',
  '/Game/Maps/Bonsai/Bonsai': 'SPLIT',
  '/Game/Maps/Duality/Duality': 'BIND',
  '/Game/Maps/Triad/Triad': 'HAVEN',
  '/Game/Maps/Port/Port': 'ICEBOX',
  '/Game/Maps/Foxtrot/Foxtrot': 'BREEZE',
  '/Game/Maps/Canyon/Canyon': 'FRACTURE',
  '/Game/Maps/Pitt/Pitt': 'PEARL',
  '/Game/Maps/Jam/Jam': 'LOTUS',
  '/Game/Maps/Jules/Jules': 'SUNSET',
  '/Game/Maps/Plummet/Plummet': 'ABYSS',
  '/Game/Maps/Infinity/Infinity': 'ABYSS',
  '/Game/Maps/Poveglia/Range': 'THE RANGE',
  '/Game/Maps/HURM/HURM_Yard': 'DISTRICT',
  '/Game/Maps/HURM/HURM_Alley': 'PIAZZA',
  '/Game/Maps/HURM/HURM_Helix': 'KASBAH',
  '/Game/Maps/HURM/HURM_Drift': 'DRIFT',
  '/Game/Maps/HURM/HURM_Glitch': 'GLITCH'
};

// Valorant Queue Mode Dictionary
const VALORANT_QUEUE_NAMES = {
  'custom': 'CUSTOM',
  'unrated': 'UNRATED',
  'competitive': 'COMPETITIVE',
  'swiftplay': 'SWIFTPLAY',
  'spikerush': 'SPIKE RUSH',
  'deathmatch': 'DEATHMATCH',
  'hurm': 'TDM',
  'ggteam': 'ESCALATION',
  'onefa': 'REPLICATION',
  'snowball': 'SNOWBALL',
  'premier': 'PREMIER',
  'tournament': 'TOURNAMENT'
};

function formatMapName(rawMap) {
  if (!rawMap) return 'ASCENT';
  if (VALORANT_MAP_NAMES[rawMap]) return VALORANT_MAP_NAMES[rawMap];
  
  const lower = String(rawMap).toLowerCase();
  if (lower.includes('ascent')) return 'ASCENT';
  if (lower.includes('bonsai') || lower.includes('split')) return 'SPLIT';
  if (lower.includes('duality') || lower.includes('bind')) return 'BIND';
  if (lower.includes('triad') || lower.includes('haven')) return 'HAVEN';
  if (lower.includes('port') || lower.includes('icebox')) return 'ICEBOX';
  if (lower.includes('foxtrot') || lower.includes('breeze')) return 'BREEZE';
  if (lower.includes('canyon') || lower.includes('fracture')) return 'FRACTURE';
  if (lower.includes('pitt') || lower.includes('pearl')) return 'PEARL';
  if (lower.includes('jam') || lower.includes('lotus')) return 'LOTUS';
  if (lower.includes('jules') || lower.includes('sunset')) return 'SUNSET';
  if (lower.includes('plummet') || lower.includes('infinity') || lower.includes('abyss')) return 'ABYSS';
  if (lower.includes('range') || lower.includes('poveglia')) return 'THE RANGE';
  if (lower.includes('district') || lower.includes('yard')) return 'DISTRICT';
  if (lower.includes('piazza') || lower.includes('alley')) return 'PIAZZA';
  if (lower.includes('kasbah') || lower.includes('helix')) return 'KASBAH';
  if (lower.includes('drift')) return 'DRIFT';
  if (lower.includes('glitch')) return 'GLITCH';

  const parts = String(rawMap).split('/').filter(Boolean);
  return (parts[parts.length - 1] || 'ASCENT').toUpperCase();
}

function formatQueueName(queueId, provisioningFlow) {
  if (provisioningFlow === 'CustomGame' || queueId === 'custom' || !queueId) {
    return 'CUSTOM';
  }
  const qLower = (queueId || '').toLowerCase();
  if (VALORANT_QUEUE_NAMES[qLower]) return VALORANT_QUEUE_NAMES[qLower];
  return qLower.toUpperCase();
}

class ScorePoller {
  constructor(config, onUpdateCallback) {
    this.config = config || {};
    this.onUpdateCallback = onUpdateCallback;
    this.timer = null;
    this.currentMatchId = null;
    this.lastScoreData = null;
    this.lastBroadcastTime = 0;
    this.inGame = false;
    this.isPolling = false;
  }

  start() {
    if (this.isPolling) return;
    this.isPolling = true;
    const activeInterval = this.config.pollingIntervalMs || 2500;
    const idleInterval = this.config.idlePollingIntervalMs || 5000;
    logger.info(`[ScorePoller] Started poller (Active: ${activeInterval}ms, Idle: ${idleInterval}ms).`);

    const pollLoop = async () => {
      if (!this.isPolling) return;
      try {
        await this.pollOnce();
      } catch (err) {
        logger.error('[ScorePoller] Unexpected poll error:', err.message);
      } finally {
        if (this.isPolling) {
          const nextInterval = this.inGame ? activeInterval : idleInterval;
          this.timer = setTimeout(pollLoop, nextInterval);
        }
      }
    };

    pollLoop();
  }

  stop() {
    this.isPolling = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    logger.info('[ScorePoller] Poller stopped.');
  }

  async pollOnce() {
    let auth = await getAuthData(false, this.config.tokenAutoRefreshMins || 45);
    if (!auth || !auth.lockfile) {
      this.notifyUpdate({
        inGame: false,
        matchId: null,
        alliedScore: 0,
        enemyScore: 0,
        status: 'GAME_CLOSED',
        timestamp: Date.now()
      });
      return;
    }

    // --- Strategy 1: Local Client Presence API ---
    try {
      const presenceRes = await fetch(`${auth.lockfile.baseUrl}/chat/v4/presences`, {
        headers: { 'Authorization': auth.lockfile.authHeader }
      });

      if (presenceRes.ok) {
        const presenceData = await presenceRes.json();
        const myPresence = presenceData.presences ? presenceData.presences.find(p => p.puuid === auth.puuid) : null;

        if (myPresence && myPresence.private) {
          const decoded = JSON.parse(Buffer.from(myPresence.private, 'base64').toString('utf8'));
          const loopState = decoded.sessionLoopState || decoded.partyPresenceData?.partyOwnerSessionLoopState;

          if (loopState === 'INGAME') {
            const alliedScore = typeof decoded.partyOwnerMatchScoreAllyTeam === 'number'
              ? decoded.partyOwnerMatchScoreAllyTeam
              : (decoded.partyPresenceData?.partyOwnerMatchScoreAllyTeam || 0);

            const enemyScore = typeof decoded.partyOwnerMatchScoreEnemyTeam === 'number'
              ? decoded.partyOwnerMatchScoreEnemyTeam
              : (decoded.partyPresenceData?.partyOwnerMatchScoreEnemyTeam || 0);

            const status = evaluateAlertStatus(alliedScore, enemyScore, this.config.alertEnemyScoreThreshold || 11);

            const rawMap = decoded.matchPresenceData?.matchMap || decoded.matchMap || decoded.partyPresenceData?.matchMap || decoded.partyPresenceData?.partyOwnerMatchMap || decoded.partyOwnerMatchMap;
            const mapName = formatMapName(rawMap);
            const queueId = decoded.matchPresenceData?.queueId || decoded.queueId || decoded.partyPresenceData?.partyOwnerProvisioningFlow;
            const provisioningFlow = decoded.provisioningFlow || decoded.partyPresenceData?.partyOwnerProvisioningFlow;
            const gameMode = formatQueueName(queueId, provisioningFlow);

            this.notifyUpdate({
              inGame: true,
              matchId: mapName,
              mapName: mapName,
              gameMode: gameMode,
              alliedScore,
              enemyScore,
              status,
              timestamp: Date.now()
            });
            return;
          }
        }
      }
    } catch (err) {
      logger.warn('[ScorePoller] Local presence check fallback:', err.message);
    }

    // --- Strategy 2: Riot GLZ Regional API Fallback ---
    const regionInfo = getRegionInfo();
    const { region, shard, clientVersion } = regionInfo;

    const headers = {
      'Authorization': `Bearer ${auth.accessToken}`,
      'X-Riot-Entitlements-JWT': auth.entitlement,
      'X-Riot-ClientPlatform': CLIENT_PLATFORM_BASE64,
      'X-Riot-ClientVersion': clientVersion
    };

    const playerUrl = `https://glz-${region}-1.${shard}.a.pvp.net/core-game/v1/players/${auth.puuid}`;

    try {
      let res = await fetch(playerUrl, { headers });

      if (res.status === 401) {
        auth = await getAuthData(true, this.config.tokenAutoRefreshMins || 45);
        if (!auth) return;
        headers['Authorization'] = `Bearer ${auth.accessToken}`;
        headers['X-Riot-Entitlements-JWT'] = auth.entitlement;
        res = await fetch(playerUrl, { headers });
      }

      if (res.status === 404) {
        if (this.currentMatchId !== null) {
          logger.info('[ScorePoller] Match ended or player returned to lobby.');
          this.currentMatchId = null;
        }

        this.notifyUpdate({
          inGame: false,
          matchId: null,
          alliedScore: 0,
          enemyScore: 0,
          status: 'NO_MATCH',
          timestamp: Date.now()
        });
        return;
      }

      if (!res.ok) return;

      const playerData = await res.json();
      const matchId = playerData.MatchID;

      if (!matchId) {
        this.notifyUpdate({
          inGame: false,
          matchId: null,
          alliedScore: 0,
          enemyScore: 0,
          status: 'NO_MATCH',
          timestamp: Date.now()
        });
        return;
      }

      this.currentMatchId = matchId;

      const matchUrl = `https://glz-${region}-1.${shard}.a.pvp.net/core-game/v1/matches/${matchId}`;
      const matchRes = await fetch(matchUrl, { headers });

      if (!matchRes.ok) return;

      const matchData = await matchRes.json();

      const myPlayer = matchData.Players ? matchData.Players.find(p => p.Subject === auth.puuid) : null;
      const myTeamId = myPlayer ? myPlayer.TeamID : null;

      let alliedScore = 0;
      let enemyScore = 0;

      if (matchData.Teams && Array.isArray(matchData.Teams) && myTeamId) {
        const alliedTeam = matchData.Teams.find(t => t.TeamID === myTeamId);
        const enemyTeam = matchData.Teams.find(t => t.TeamID !== myTeamId);

        alliedScore = alliedTeam ? alliedTeam.RoundsWon : 0;
        enemyScore = enemyTeam ? enemyTeam.RoundsWon : 0;
      }

      const status = evaluateAlertStatus(alliedScore, enemyScore, this.config.alertEnemyScoreThreshold || 11);
      const rawMap = matchData.MapID;
      const mapName = formatMapName(rawMap);
      const queueId = matchData.MatchmakingData?.QueueID || matchData.QueueID;
      const gameMode = formatQueueName(queueId, matchData.ProvisioningFlow);

      this.notifyUpdate({
        inGame: true,
        matchId: mapName,
        mapName: mapName,
        gameMode: gameMode,
        alliedScore,
        enemyScore,
        status,
        timestamp: Date.now()
      });

    } catch (err) {
      logger.error('[ScorePoller] Polling exception:', err.message);
    }
  }

  notifyUpdate(data) {
    this.inGame = !!data.inGame;

    const last = this.lastScoreData;
    const isDifferent = !last ||
      last.inGame !== data.inGame ||
      last.alliedScore !== data.alliedScore ||
      last.enemyScore !== data.enemyScore ||
      last.status !== data.status ||
      last.matchId !== data.matchId ||
      last.gameMode !== data.gameMode;

    if (isDifferent || (Date.now() - (this.lastBroadcastTime || 0) > 10000)) {
      this.lastBroadcastTime = Date.now();
      if (this.onUpdateCallback) {
        this.onUpdateCallback(data);
      }
    }
    this.lastScoreData = data;
  }
}

module.exports = ScorePoller;
