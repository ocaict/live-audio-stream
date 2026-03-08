const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const UserModel = require('../models/user');
const CONFIG = require('../config/constants');

const AuthService = {
  async register(username, password, role = 'broadcaster') {
    const existingUser = await UserModel.findByUsername(username);
    if (existingUser) {
      throw new Error('Username already exists');
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    return await UserModel.create({
      username,
      passwordHash,
      role
    });
  },

  async login(username, password) {
    console.log(`[AUTH] Login attempt for: "${username}"`);

    // Try user table first
    const user = await UserModel.findByUsername(username);

    if (!user) {
      console.warn(`[AUTH] User NOT found in database: "${username}"`);
      throw new Error('Invalid credentials');
    }

    console.log(`[AUTH] User found: ${user.username} (Role: ${user.role || 'broadcaster'})`);

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      console.warn(`[AUTH] Password mismatch for user: "${username}"`);
      throw new Error('Invalid credentials');
    }

    console.log(`[AUTH] Login successful for: ${user.username}`);

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role || 'broadcaster' },
      CONFIG.JWT_SECRET,
      { expiresIn: CONFIG.JWT_EXPIRES_IN }
    );

    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role || 'broadcaster'
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
