const { createClient } = require('redis');
const config = require('./config');
const logger = require('./utils/logger');

function buildRedisOptions() {
  const reconnectStrategy = (retries) => {
    const delay = Math.min(retries * 200, 3000);
    logger.warn(`Redis reconnecting attempt ${retries}... retry in ${delay}ms`);
    return delay;
  };

  if (config.redisUrl) {
    return {
      url: config.redisUrl,
      socket: { reconnectStrategy }
    };
  }

  const options = {
    socket: {
      host: config.redis.host,
      port: config.redis.port,
      reconnectStrategy
    }
  };

  if (config.redis.password) {
    options.password = config.redis.password;
  }

  return options;
}

const mainClient = createClient(buildRedisOptions());
let pubClient;
let subClient;

mainClient.on('error', (err) => {
  logger.error('Redis Main Client Error:', { error: err.message });
});

mainClient.on('connect', () => {
  logger.info('Redis Main Client Connected', { host: config.redis.host, port: config.redis.port });
});

mainClient.on('ready', () => {
  logger.info('Redis Main Client Ready');
});

mainClient.on('reconnecting', () => {
  logger.warn('Redis Main Client Reconnecting...');
});

async function connectRedis() {
  if (!mainClient.isOpen) {
    await mainClient.connect();
  }

  if (!pubClient) {
    pubClient = mainClient.duplicate();
    pubClient.on('error', (err) => logger.error('Redis Pub Client Error:', { error: err.message }));
    await pubClient.connect();
  }

  if (!subClient) {
    subClient = mainClient.duplicate();
    subClient.on('error', (err) => logger.error('Redis Sub Client Error:', { error: err.message }));
    await subClient.connect();
  }

  // Seed default rooms
  try {
    for (const room of config.defaultRooms) {
      await mainClient.sAdd('rooms', room);
    }
    logger.info('Default rooms seeded successfully', { rooms: config.defaultRooms });
  } catch (err) {
    logger.error('Failed to seed default rooms', { error: err.message });
  }

  return { mainClient, pubClient, subClient };
}

async function pingRedis() {
  try {
    if (!mainClient.isOpen) return false;
    const res = await mainClient.ping();
    return res === 'PONG';
  } catch (err) {
    return false;
  }
}

async function disconnectRedis() {
  try {
    if (subClient && subClient.isOpen) await subClient.quit();
    if (pubClient && pubClient.isOpen) await pubClient.quit();
    if (mainClient && mainClient.isOpen) await mainClient.quit();
    logger.info('Redis clients disconnected successfully');
  } catch (err) {
    logger.error('Error disconnecting Redis clients', { error: err.message });
  }
}

module.exports = {
  mainClient,
  getPubClient: () => pubClient,
  getSubClient: () => subClient,
  connectRedis,
  pingRedis,
  disconnectRedis
};
