const logger = require('../utils/logger');
const { saveMessage, getHistory } = require('../services/messageService');
const { addUserToRoom, removeUserFromRoom, handleSocketDisconnect } = require('../services/presenceService');
const { checkRateLimit } = require('../services/rateLimiter');

function registerChatHandlers(io, socket) {
  const username = socket.user?.username;

  logger.info('Registering chat socket handlers', { socketId: socket.id, username });

  // Handle joining a room
  socket.on('room:join', async (data) => {
    try {
      const room = typeof data?.room === 'string' ? data.room.trim().toLowerCase() : null;
      if (!room) {
        socket.emit('error:validation', { message: 'Invalid room name provided' });
        return;
      }

      await socket.join(room);
      logger.info('User joined room', { username, room, socketId: socket.id });

      // Add user to presence list in Redis
      const onlineUsers = await addUserToRoom(socket.id, username, room);

      // Send recent message history to the joined client (last 50 messages)
      const history = await getHistory(room, 50);
      socket.emit('room:history', history);

      // Broadcast updated presence list to everyone in the room (including joiner)
      io.to(room).emit('presence:update', { room, users: onlineUsers });
    } catch (err) {
      logger.error('Error in room:join handler', { error: err.message, username });
      socket.emit('error:validation', { message: 'Failed to join room' });
    }
  });

  // Handle leaving a room
  socket.on('room:leave', async (data) => {
    try {
      const room = typeof data?.room === 'string' ? data.room.trim().toLowerCase() : null;
      if (!room) return;

      await socket.leave(room);
      logger.info('User left room', { username, room, socketId: socket.id });

      // Remove from room presence
      const remainingUsers = await removeUserFromRoom(socket.id, username, room);

      // Notify other users in the room
      io.to(room).emit('presence:update', { room, users: remainingUsers });
    } catch (err) {
      logger.error('Error in room:leave handler', { error: err.message, username });
    }
  });

  // Handle sending a message
  socket.on('message:send', async (data) => {
    try {
      const room = typeof data?.room === 'string' ? data.room.trim().toLowerCase() : null;
      const rawText = data?.text;

      // Validation: room and non-empty string, trimmed, max 1000 characters
      if (!room) {
        socket.emit('error:validation', { message: 'Room identifier is required' });
        return;
      }

      if (typeof rawText !== 'string' || !rawText.trim()) {
        socket.emit('error:validation', { message: 'Message text cannot be empty' });
        return;
      }

      const text = rawText.trim();
      if (text.length > 1000) {
        socket.emit('error:validation', { message: 'Message cannot exceed 1000 characters' });
        return;
      }

      // Check Rate Limiter (5 msgs / 10s per user)
      const rateCheck = await checkRateLimit(username);
      if (!rateCheck.allowed) {
        socket.emit('error:rate_limit', {
          retryAfter: rateCheck.retryAfter || 10,
          message: `Rate limit exceeded. Please wait ${rateCheck.retryAfter || 10} seconds.`
        });
        return;
      }

      // Save message to Redis
      const savedMessage = await saveMessage({ room, user: username, text });

      // Broadcast to all clients in the room (including sender)
      io.to(room).emit('message:new', savedMessage);
      logger.info('Message sent and broadcasted', { room, user: username, messageId: savedMessage.id });
    } catch (err) {
      logger.error('Error in message:send handler', { error: err.message, username });
      socket.emit('error:validation', { message: 'Failed to process message' });
    }
  });

  // Handle typing indicator start
  socket.on('typing:start', (data) => {
    const room = typeof data?.room === 'string' ? data.room.trim().toLowerCase() : null;
    if (room) {
      socket.to(room).emit('typing', { room, user: username, isTyping: true });
    }
  });

  // Handle typing indicator stop
  socket.on('typing:stop', (data) => {
    const room = typeof data?.room === 'string' ? data.room.trim().toLowerCase() : null;
    if (room) {
      socket.to(room).emit('typing', { room, user: username, isTyping: false });
    }
  });

  // Handle disconnect
  socket.on('disconnect', async (reason) => {
    logger.info('Socket disconnected', { socketId: socket.id, username, reason });
    try {
      const { affectedRooms } = await handleSocketDisconnect(socket.id);
      for (const item of affectedRooms) {
        io.to(item.room).emit('presence:update', { room: item.room, users: item.users });
      }
    } catch (err) {
      logger.error('Error during disconnect cleanup', { error: err.message, socketId: socket.id });
    }
  });
}

module.exports = registerChatHandlers;
