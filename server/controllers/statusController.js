const webrtcService = require('../services/webrtcService');

const statusController = {
  getStatus(req, res) {
    const status = webrtcService.getStatus();
    res.json(status);
  }
};

module.exports = statusController;
