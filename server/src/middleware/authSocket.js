const jwt = require('jsonwebtoken');
const config = require('../config');
const logger = require('../utils/logger');

function authSocket(socket, next) {
  try {
    const token =
      socket.handshake.auth?.token ||
      (socket.handshake.headers?.authorization?.startsWith('Bearer ')
        ? socket.handshake.headers.authorization.split(' ')[1]
        : null);

    if (!token) {
      logger.warn('Socket connection rejected: No token provided', { socketId: socket.id });
      return next(new Error('Authentication error: Token required'));
    }

    const decoded = jwt.verify(token, config.jwtSecret);
    socket.user = {
      id: decoded.id,
      username: decoded.username
    };
    logger.info('Socket authenticated successfully', { socketId: socket.id, username: decoded.username });
    next();
  } catch (err) {
    logger.warn('Socket connection rejected: Invalid token', { socketId: socket.id, error: err.message });
    return next(new Error('Authentication error: Invalid or expired token'));
  }
}

module.exports = authSocket;
