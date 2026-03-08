const webrtcService = require('../services/webrtcService');
const CONFIG = require('../config/constants');

const statusController = {
  getStatus(req, res) {
    const status = webrtcService.getStatus();
    res.json(status);
  },

  getRTCConfig(req, res) {
    res.json({
      iceServers: CONFIG.ICE_SERVERS
    });
  }
};

module.exports = statusController;
