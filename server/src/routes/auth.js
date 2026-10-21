const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const config = require('../config');
const { mainClient } = require('../redis');
const logger = require('../utils/logger');
const authHttp = require('../middleware/authHttp');

const router = express.Router();

// Helper to normalize username
function normalizeUsername(username) {
  return typeof username === 'string' ? username.trim().toLowerCase() : '';
}

// POST /register
router.post('/register', async (req, res) => {
  try {
    const { username: rawUsername, password } = req.body;
    const username = normalizeUsername(rawUsername);

    if (!username || username.length < 3 || username.length > 30) {
      return res.status(400).json({ error: 'Username must be between 3 and 30 characters' });
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({ error: 'Username can only contain alphanumeric characters and underscores' });
    }

    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const userKey = `user:${username}`;
    const exists = await mainClient.exists(userKey);
    if (exists) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    const userId = uuidv4();
    const passwordHash = await bcrypt.hash(password, 10);
    const createdAt = new Date().toISOString();

    await mainClient.hSet(userKey, {
      id: userId,
      username,
      passwordHash,
      createdAt
    });

    const token = jwt.sign({ id: userId, username }, config.jwtSecret, {
      expiresIn: config.jwtExpiresIn
    });

    logger.info('User registered successfully', { username, userId });

    return res.status(201).json({
      message: 'Registration successful',
      token,
      user: { id: userId, username }
    });
  } catch (err) {
    logger.error('Registration error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error during registration' });
  }
});

// POST /login
router.post('/login', async (req, res) => {
  try {
    const { username: rawUsername, password } = req.body;
    const username = normalizeUsername(rawUsername);

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const userKey = `user:${username}`;
    const userData = await mainClient.hGetAll(userKey);

    if (!userData || !userData.passwordHash) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const isMatch = await bcrypt.compare(password, userData.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = jwt.sign(
      { id: userData.id, username: userData.username || username },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn }
    );

    logger.info('User logged in successfully', { username, userId: userData.id });

    return res.status(200).json({
      message: 'Login successful',
      token,
      user: { id: userData.id, username: userData.username || username }
    });
  } catch (err) {
    logger.error('Login error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error during login' });
  }
});

// GET /me (Verify token)
router.get('/me', authHttp, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
