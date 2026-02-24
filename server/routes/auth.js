const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const authController = require('../controllers/authController');
const { authenticateToken } = require('../middleware/auth');
const { loginValidation } = require('../middleware/validation');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts, please try again later' }
});

router.post('/login', loginLimiter, loginValidation, authController.login);
router.post('/logout', authenticateToken, authController.logout);
router.get('/check', authenticateToken, authController.check);

module.exports = router;
