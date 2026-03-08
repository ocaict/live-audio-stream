const AuthService = require('../services/authService');

const authController = {
  async register(req, res) {
    try {
      const { username, password, role } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
      }

      await AuthService.register(username, password, role);
      res.status(201).json({ message: 'User registered successfully' });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },

  async login(req, res) {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
      }

      const result = await AuthService.login(username, password);

      res.cookie('token', result.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000
      });

      res.json({ user: result.user });
    } catch (error) {
      res.status(401).json({ error: error.message });
    }
  },

  logout(req, res) {
    res.clearCookie('token');
    res.json({ message: 'Logged out successfully' });
  },

  check(req, res) {
    if (req.user) {
      res.json({ authenticated: true, user: req.user });
    } else {
      res.json({ authenticated: false });
    }
  }
};

module.exports = authController;
