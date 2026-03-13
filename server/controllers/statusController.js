const webrtcService = require('../services/webrtcService');
const CONFIG = require('../config/constants');

const statusController = {
  getStatus(req, res) {
    const status = webrtcService.getStatus();
    res.json(status);
  },

  async getRTCConfig(req, res) {
    try {
      // If a Metered.ca API Key is present, try to fetch dynamic credentials
      if (CONFIG.METERED_API_KEY) {
        const appName = CONFIG.METERED_APP_NAME;
        console.log(`[RTC] Fetching dynamic TURN credentials from ${appName}.metered.live...`);
        
        // Use the specific endpoint provided by the user
        const primaryUrl = `https://${appName}.metered.live/api/v1/turn/credentials?apiKey=${CONFIG.METERED_API_KEY}`;
        const fallbackUrl = `https://metered.live/api/v1/turn/credentials?apiKey=${CONFIG.METERED_API_KEY}`;

        for (const url of [primaryUrl, fallbackUrl]) {
          try {
            const response = await fetch(url);
            if (response.ok) {
              const iceServers = await response.json();
              console.log('[RTC] Successfully fetched dynamic TURN credentials.');
              return res.json({ iceServers });
            }
          } catch (e) {
            console.warn(`[RTC] Failed to fetch from ${url}:`, e.message);
          }
        }
        
        console.warn('[RTC] Metered API returned error or key is invalid, falling back to static config.');
      }

      // Fallback to static config if API key is missing or request fails
      res.json({
        iceServers: CONFIG.ICE_SERVERS
      });
    } catch (error) {
      console.error('[RTC] Error fetching dynamic config:', error);
      res.json({
        iceServers: CONFIG.ICE_SERVERS
      });
    }
  },

  getPublicConfig(req, res) {
    res.json({
      supabaseUrl: CONFIG.SUPABASE_URL,
      supabaseKey: CONFIG.SUPABASE_KEY // This should be the Anon/Public Key
    });
  }
};

module.exports = statusController;
