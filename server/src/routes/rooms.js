const express = require('express');
const { mainClient } = require('../redis');
const { getHistory } = require('../services/messageService');
const authHttp = require('../middleware/authHttp');
const logger = require('../utils/logger');
const config = require('../config');

const router = express.Router();

// GET /rooms - List available chat rooms
router.get('/rooms', async (req, res) => {
  try {
    let rooms = await mainClient.sMembers('rooms');
    if (!rooms || rooms.length === 0) {
      rooms = config.defaultRooms;
    }
    // Return sorted room list
    rooms.sort();
    return res.json({ rooms });
  } catch (err) {
    logger.error('Error fetching rooms', { error: err.message });
    return res.status(500).json({ error: 'Failed to fetch rooms' });
  }
});

// GET /rooms/:id/messages - Fetch message history for a room
router.get('/rooms/:id/messages', authHttp, async (req, res) => {
  try {
    const roomId = req.params.id;
    const limit = parseInt(req.query.limit, 10) || 50;
    const messages = await getHistory(roomId, limit);
    return res.json({ room: roomId, messages });
  } catch (err) {
    logger.error('Error fetching room messages', { error: err.message, room: req.params.id });
    return res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

module.exports = router;
