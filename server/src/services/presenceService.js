const { mainClient } = require('../redis');
const logger = require('../utils/logger');

const SOCKET_KEY_TTL = 86400; // 24 hours

/**
 * Add a user to room presence in Redis
 */
async function addUserToRoom(socketId, username, room) {
  if (!mainClient.isOpen) return [];
  try {
    const roomKey = `room:${room}:online`;
    const socketRoomsKey = `socket:${socketId}:rooms`;
    const socketUserKey = `socket:${socketId}`;

    await Promise.all([
      mainClient.sAdd(roomKey, username),
      mainClient.sAdd(socketRoomsKey, room),
      mainClient.hSet(socketUserKey, { username, updatedAt: Date.now() })
    ]);

    await Promise.all([
      mainClient.expire(socketRoomsKey, SOCKET_KEY_TTL),
      mainClient.expire(socketUserKey, SOCKET_KEY_TTL)
    ]);

    const users = await getOnlineUsers(room);
    return users;
  } catch (err) {
    logger.error('Failed to add user to room presence', { error: err.message, socketId, username, room });
    return [];
  }
}

/**
 * Remove user from room presence
 */
async function removeUserFromRoom(socketId, username, room) {
  if (!mainClient.isOpen) return [];
  try {
    const roomKey = `room:${room}:online`;
    const socketRoomsKey = `socket:${socketId}:rooms`;

    await Promise.all([
      mainClient.sRem(roomKey, username),
      mainClient.sRem(socketRoomsKey, room)
    ]);

    const users = await getOnlineUsers(room);
    return users;
  } catch (err) {
    logger.error('Failed to remove user from room presence', { error: err.message, socketId, username, room });
    return [];
  }
}

/**
 * Get all online users for a given room
 */
async function getOnlineUsers(room) {
  if (!mainClient.isOpen) return [];
  try {
    const roomKey = `room:${room}:online`;
    const users = await mainClient.sMembers(roomKey);
    return users ? users.sort() : [];
  } catch (err) {
    logger.error('Failed to get online users', { error: err.message, room });
    return [];
  }
}

/**
 * Clean up presence when a socket disconnects
 * Returns affected rooms and username so presence updates can be broadcast
 */
async function handleSocketDisconnect(socketId) {
  if (!mainClient.isOpen) return { username: null, affectedRooms: [] };
  try {
    const socketRoomsKey = `socket:${socketId}:rooms`;
    const socketUserKey = `socket:${socketId}`;

    const [rooms, userData] = await Promise.all([
      mainClient.sMembers(socketRoomsKey),
      mainClient.hGetAll(socketUserKey)
    ]);

    const username = userData?.username;
    const affectedRooms = [];

    if (username && rooms && rooms.length > 0) {
      for (const room of rooms) {
        await mainClient.sRem(`room:${room}:online`, username);
        const remainingUsers = await getOnlineUsers(room);
        affectedRooms.push({ room, users: remainingUsers });
      }
    }

    // Clean up socket metadata keys
    await Promise.all([
      mainClient.del(socketRoomsKey),
      mainClient.del(socketUserKey)
    ]);

    return { username, affectedRooms };
  } catch (err) {
    logger.error('Failed during socket disconnect cleanup', { error: err.message, socketId });
    return { username: null, affectedRooms: [] };
  }
}

module.exports = {
  addUserToRoom,
  removeUserFromRoom,
  getOnlineUsers,
  handleSocketDisconnect
};
