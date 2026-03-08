const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const AdminModel = require('../models/admin');
const CONFIG = require('../config/constants');

const AuthService = {
  async login(username, password) {
    const admin = await AdminModel.findByUsername(username);
    if (!admin) {
      throw new Error('Invalid credentials');
    }

    const validPassword = await bcrypt.compare(password, admin.password_hash);
    if (!validPassword) {
      throw new Error('Invalid credentials');
    }

    const token = jwt.sign(
      { id: admin.id, username: admin.username },
      CONFIG.JWT_SECRET,
      { expiresIn: CONFIG.JWT_EXPIRES_IN }
    );

    return {
      token,
      user: {
        id: admin.id,
        username: admin.username
      }
    };
  },

  verifyToken(token) {
    try {
      return jwt.verify(token, CONFIG.JWT_SECRET);
    } catch (error) {
      return null;
    }
  },

  generateToken(payload) {
    return jwt.sign(payload, CONFIG.JWT_SECRET, { expiresIn: CONFIG.JWT_EXPIRES_IN });
  }
};

module.exports = AuthService;
