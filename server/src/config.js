require('dotenv').config();

const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'chat-app-super-secret-key-default',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h',
  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD !== undefined ? process.env.REDIS_PASSWORD : '',
  },
  clientOrigin: process.env.CLIENT_ORIGIN || '*',
  defaultRooms: ['general', 'random', 'tech'],
  rateLimit: {
    maxMessages: 5,
    windowSeconds: 10
  }
};

module.exports = config;
