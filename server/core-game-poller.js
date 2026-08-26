const { getAuthData } = require('./riot-auth');
const { getRegionInfo } = require('./riot-region');

const CLIENT_PLATFORM_BASE64 = 'ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQ0LjEuMjU2LjEuNTEyLjE1IiwNCgkicGxhdGZvcm1WYWx1ZSI6ICJidWlsZC0xMTQ4NzQ3LWxpc3QiDQp9';

class CoreGamePoller {
  constructor(onUpdateCallback) {
    this.onUpdateCallback = onUpdateCallback;
    this.timer = null;
    this.currentMatchId = null;
    this.lastScoreData = null;
    this.isPolling = false;
  }

  start(intervalMs = 3000) {
    if (this.isPolling) return;
    this.isPolling = true;
    console.log(`[CoreGamePoller] Started poller with ${intervalMs}ms interval.`);

    const pollLoop = async () => {
      if (!this.isPolling) return;
      try {
        await this.pollOnce();
      } catch (err) {
        console.error('[CoreGamePoller] Unexpected poll error:', err.message);
      } finally {
        if (this.isPolling) {
          this.timer = setTimeout(pollLoop, intervalMs);
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
    console.log('[CoreGamePoller] Poller stopped.');
  }

  async pollOnce() {
    let auth = await getAuthData();
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

    // --- Strategy 1: Local Client Presence API (Instant Realtime Score for Custom, Competitive, Unrated) ---
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

            let status = 'IN_MATCH';
            if (enemyScore >= 11 && alliedScore < enemyScore) {
              status = 'MATCH_POINT_RISK';
            }

            this.notifyUpdate({
              inGame: true,
              matchId: decoded.matchPresenceData?.matchMap || 'ACTIVE_MATCH',
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
      console.warn('[CoreGamePoller] Local presence check fallback:', err.message);
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
        auth = await getAuthData(true);
        if (!auth) return;
        headers['Authorization'] = `Bearer ${auth.accessToken}`;
        headers['X-Riot-Entitlements-JWT'] = auth.entitlement;
        res = await fetch(playerUrl, { headers });
      }

      if (res.status === 404) {
        if (this.currentMatchId !== null) {
          console.log('[CoreGamePoller] Match ended or player returned to lobby.');
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

      let status = 'IN_MATCH';
      if (enemyScore >= 11 && alliedScore < enemyScore) {
        status = 'MATCH_POINT_RISK';
      }

      this.notifyUpdate({
        inGame: true,
        matchId,
        alliedScore,
        enemyScore,
        status,
        timestamp: Date.now()
      });

    } catch (err) {
      console.error('[CoreGamePoller] Polling exception:', err.message);
    }
  }

  notifyUpdate(data) {
    if (this.onUpdateCallback) {
      this.onUpdateCallback(data);
    }
    this.lastScoreData = data;
  }
}

module.exports = CoreGamePoller;
