const http = require('http');
const path = require('path');
const os = require('os');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');

const config = require('./config');
const logger = require('./utils/logger');
const { connectRedis, pingRedis, disconnectRedis, getPubClient, getSubClient } = require('./redis');

const authRoutes = require('./routes/auth');
const roomRoutes = require('./routes/rooms');
const authSocket = require('./middleware/authSocket');
const registerChatHandlers = require('./sockets/chat');

const app = express();
const server = http.createServer(app);

// Basic security and parsing middleware
app.use(
  helmet({
    contentSecurityPolicy: false // Allow client inline scripts & socket.io in simple frontend
  })
);
app.use(cors({ origin: config.clientOrigin, credentials: true }));
app.use(express.json());

// Serve static frontend files
const fs = require('fs');
const candidatePaths = [
  process.env.CLIENT_PATH,
  path.resolve(__dirname, '../client'),
  path.resolve(__dirname, '../../client')
];
const clientPath = candidatePaths.find((p) => p && fs.existsSync(p)) || path.resolve(__dirname, '../client');
app.use(express.static(clientPath));

// Health check endpoint
app.get('/health', async (req, res) => {
  const isRedisUp = await pingRedis();
  const status = isRedisUp ? 'ok' : 'degraded';
  const statusCode = isRedisUp ? 200 : 503;

  return res.status(statusCode).json({
    status,
    redis: isRedisUp ? 'up' : 'down',
    hostname: os.hostname(),
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

// REST API routes
app.use('/api', authRoutes);
app.use('/api', roomRoutes);

// Create Socket.IO instance
const io = new Server(server, {
  cors: {
    origin: config.clientOrigin,
    methods: ['GET', 'POST'],
    credentials: true
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

// Socket.IO authentication middleware
io.use(authSocket);

// Socket.IO connection event
io.on('connection', (socket) => {
  registerChatHandlers(io, socket);
});

async function bootstrap() {
  try {
    logger.info('Starting Chat App Server bootstrap...', { port: config.port, env: config.nodeEnv });

    // Connect to Redis and seed rooms
    await connectRedis();

    // Attach Redis adapter for horizontal scaling across instances
    const pub = getPubClient();
    const sub = getSubClient();
    if (pub && sub) {
      io.adapter(createAdapter(pub, sub));
      logger.info('Socket.IO Redis adapter attached successfully');
    }

    return new Promise((resolve) => {
      server.listen(config.port, () => {
        logger.info(`Chat App Server listening on port ${config.port}`, {
          hostname: os.hostname(),
          pid: process.pid
        });
        resolve({ app, server, io });
      });
    });
  } catch (err) {
    logger.error('Failed to bootstrap application', { error: err.message, stack: err.stack });
    throw err;
  }
}

// Graceful shutdown handling
async function shutdown(signal) {
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  io.close(() => {
    logger.info('Socket.IO server closed');
  });
  server.close(async () => {
    logger.info('HTTP server closed');
    await disconnectRedis();
    logger.info('Shutdown complete');
    process.exit(0);
  });

  // Force exit after 10s if graceful shutdown hangs
  setTimeout(() => {
    logger.error('Forced shutdown due to timeout');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

if (require.main === module) {
  bootstrap().catch(() => {
    process.exit(1);
  });
}

module.exports = { app, server, io, bootstrap, shutdown };
