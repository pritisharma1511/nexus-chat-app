const { v4: uuidv4 } = require('uuid');
const os = require('os');
const { mainClient } = require('../redis');
const logger = require('../utils/logger');

const MAX_HISTORY_STORED = 1000;
const DEFAULT_HISTORY_LIMIT = 50;

/**
 * Save a chat message to Redis
 * @param {Object} param0 
 * @param {string} param0.room
 * @param {string} param0.user
 * @param {string} param0.text
 * @param {number} [param0.ts]
 * @returns {Promise<Object>} The saved message object
 */
async function saveMessage({ room, user, text, ts }) {
  const message = {
    id: uuidv4(),
    room,
    user,
    text: text.trim(),
    ts: ts || Date.now(),
    hostname: os.hostname() // Helps verify horizontal scaling across containers
  };

  const key = `room:${room}:messages`;
  try {
    // Append message to room list and trim to keep at most MAX_HISTORY_STORED
    await mainClient.rPush(key, JSON.stringify(message));
    await mainClient.lTrim(key, -MAX_HISTORY_STORED, -1);
    return message;
  } catch (err) {
    logger.error('Failed to save message to Redis', { error: err.message, room, user });
    throw err;
  }
}

/**
 * Fetch recent message history for a room
 * @param {string} room 
 * @param {number} [limit=50] 
 * @returns {Promise<Array<Object>>}
 */
async function getHistory(room, limit = DEFAULT_HISTORY_LIMIT) {
  const key = `room:${room}:messages`;
  try {
    const rawMessages = await mainClient.lRange(key, -limit, -1);
    const messages = rawMessages.map((item) => {
      try {
        return JSON.parse(item);
      } catch (e) {
        return null;
      }
    }).filter(Boolean);

    return messages;
  } catch (err) {
    logger.error('Failed to fetch message history from Redis', { error: err.message, room });
    return [];
  }
}

module.exports = {
  saveMessage,
  getHistory
};
