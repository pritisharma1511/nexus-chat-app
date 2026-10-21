const { mainClient } = require('../redis');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Check if user exceeded rate limit (default: 5 messages / 10 seconds)
 * @param {string} username 
 * @returns {Promise<{ allowed: boolean, retryAfter?: number }>}
 */
async function checkRateLimit(username) {
  const { maxMessages, windowSeconds } = config.rateLimit;
  const key = `ratelimit:${username}`;

  try {
    const currentCount = await mainClient.incr(key);

    if (currentCount === 1) {
      await mainClient.expire(key, windowSeconds);
    }

    if (currentCount > maxMessages) {
      let ttl = await mainClient.ttl(key);
      if (ttl <= 0) {
        // Fallback if TTL expired exactly between operations
        ttl = windowSeconds;
      }
      logger.warn('Rate limit exceeded for user', { username, currentCount, ttl });
      return { allowed: false, retryAfter: ttl };
    }

    return { allowed: true };
  } catch (err) {
    logger.error('Rate limiter check error, failing open for reliability', { error: err.message, username });
    return { allowed: true };
  }
}

module.exports = {
  checkRateLimit
};
