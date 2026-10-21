const ioClient = require('socket.io-client');

const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:8080';

async function api(path, options = {}) {
  const url = `${baseUrl}${path}`;
  const headers = { ...options.headers };
  let body = options.body;
  if (body && typeof body === 'object') {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, body: data };
}

describe('NexusChat Real-Time Application Test Suite', () => {
  let testUserToken;
  const testUsername = `jest_user_${Date.now()}`;
  const testPassword = 'testpassword123';

  // 1. Healthcheck
  test('GET /health should return status: ok and redis: up', async () => {
    const res = await api('/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
    expect(res.body).toHaveProperty('redis', 'up');
    expect(res.body).toHaveProperty('hostname');
  });

  // 2. Auth Endpoints
  describe('Authentication REST Endpoints', () => {
    test('POST /api/register should create a new user and return JWT', async () => {
      const res = await api('/api/register', {
        method: 'POST',
        body: { username: testUsername, password: testPassword }
      });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('token');
      expect(res.body.user).toHaveProperty('username', testUsername);
      testUserToken = res.body.token;
    });

    test('POST /api/register should reject duplicate username', async () => {
      const res = await api('/api/register', {
        method: 'POST',
        body: { username: testUsername, password: testPassword }
      });

      expect(res.status).toBe(409);
      expect(res.body).toHaveProperty('error', 'Username already taken');
    });

    test('POST /api/register should reject invalid username or password', async () => {
      const res = await api('/api/register', {
        method: 'POST',
        body: { username: 'ab', password: '123' }
      });

      expect(res.status).toBe(400);
    });

    test('POST /api/login should reject incorrect password', async () => {
      const res = await api('/api/login', {
        method: 'POST',
        body: { username: testUsername, password: 'wrongpassword' }
      });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error', 'Invalid username or password');
    });

    test('POST /api/login should authenticate and return JWT with correct password', async () => {
      const res = await api('/api/login', {
        method: 'POST',
        body: { username: testUsername, password: testPassword }
      });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('token');
      expect(res.body.user.username).toBe(testUsername);
    });

    test('GET /api/me should return user details with valid token', async () => {
      const res = await api('/api/me', {
        headers: { Authorization: `Bearer ${testUserToken}` }
      });

      expect(res.status).toBe(200);
      expect(res.body.user.username).toBe(testUsername);
    });

    test('GET /api/me should reject requests without token', async () => {
      const res = await api('/api/me');
      expect(res.status).toBe(401);
    });

    test('GET /api/rooms should return default room list', async () => {
      const res = await api('/api/rooms');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.rooms)).toBe(true);
      expect(res.body.rooms).toContain('general');
    });
  });

  // 3. Socket.IO Handshake Auth
  describe('Socket.IO Handshake Authentication', () => {
    test('Should reject connection when no token is provided', (done) => {
      const socket = ioClient(baseUrl, {
        transports: ['websocket', 'polling'],
        reconnection: false
      });

      socket.on('connect_error', (err) => {
        expect(err.message).toMatch(/Authentication error/);
        socket.close();
        done();
      });

      socket.on('connect', () => {
        socket.close();
        done(new Error('Socket should not have connected without token'));
      });
    });

    test('Should successfully connect when valid token is provided', (done) => {
      const socket = ioClient(baseUrl, {
        auth: { token: testUserToken },
        transports: ['websocket', 'polling'],
        reconnection: false
      });

      socket.on('connect', () => {
        expect(socket.connected).toBe(true);
        socket.close();
        done();
      });

      socket.on('connect_error', (err) => {
        socket.close();
        done(err);
      });
    });
  });

  // 4. Core Chat and History
  describe('Core Chat, History, and Message Validation', () => {
    let socketAlice;
    let socketBob;
    let bobToken;
    const bobUsername = `jest_bob_${Date.now()}`;

    beforeAll(async () => {
      const res = await api('/api/register', {
        method: 'POST',
        body: { username: bobUsername, password: 'password123' }
      });
      bobToken = res.body.token;
    });

    afterAll(() => {
      if (socketAlice && socketAlice.connected) socketAlice.close();
      if (socketBob && socketBob.connected) socketBob.close();
    });

    test('Clients exchange messages and history is retrieved', async () => {
      const room = 'jest_room_' + Date.now();
      const testMsgText = 'Automated Jest integration message';

      socketAlice = ioClient(baseUrl, { auth: { token: testUserToken }, transports: ['websocket', 'polling'] });
      socketBob = ioClient(baseUrl, { auth: { token: bobToken }, transports: ['websocket', 'polling'] });

      await Promise.all([
        new Promise((r) => socketAlice.on('connect', r)),
        new Promise((r) => socketBob.on('connect', r))
      ]);

      const historyPromise = new Promise((r) => socketAlice.on('room:history', r));
      socketAlice.emit('room:join', { room });
      const history = await historyPromise;
      expect(Array.isArray(history)).toBe(true);

      const bobJoinPromise = new Promise((r) => socketBob.on('room:history', r));
      socketBob.emit('room:join', { room });
      await bobJoinPromise;

      const bobMessagePromise = new Promise((r) => {
        socketBob.on('message:new', (msg) => {
          if (msg.text === testMsgText && msg.user === testUsername) {
            r(msg);
          }
        });
      });

      socketAlice.emit('message:send', { room, text: testMsgText });
      const receivedMsg = await bobMessagePromise;

      expect(receivedMsg.room).toBe(room);
      expect(receivedMsg).toHaveProperty('id');
      expect(receivedMsg).toHaveProperty('ts');
      expect(receivedMsg).toHaveProperty('hostname');
    }, 10000);

    test('Validation: Empty or oversized messages trigger error:validation', (done) => {
      const socket = ioClient(baseUrl, { auth: { token: testUserToken }, transports: ['websocket', 'polling'] });

      socket.on('connect', () => {
        socket.emit('room:join', { room: 'general' });
        setTimeout(() => {
          socket.emit('message:send', { room: 'general', text: '    ' });
        }, 150);
      });

      socket.on('error:validation', (err) => {
        expect(err).toHaveProperty('message');
        socket.close();
        done();
      });
    }, 10000);
  });

  // 5. Presence Tracking
  describe('Presence Tracking & Cleanup', () => {
    test('Presence updates on join and removes user on disconnect', (done) => {
      const room = 'jest_presence_' + Date.now();
      const socket = ioClient(baseUrl, { auth: { token: testUserToken }, transports: ['websocket', 'polling'] });

      socket.on('connect', () => {
        socket.emit('room:join', { room });
      });

      socket.on('presence:update', (data) => {
        if (data.users.includes(testUsername)) {
          socket.close();
          done();
        }
      });
    }, 10000);
  });

  // 6. Rate Limiting
  describe('Rate Limiting', () => {
    test('Emits error:rate_limit when user sends more than 5 messages per 10 seconds', async () => {
      const spammerName = `jest_spam_${Date.now()}`;
      const res = await api('/api/register', {
        method: 'POST',
        body: { username: spammerName, password: 'password123' }
      });

      const socket = ioClient(baseUrl, { auth: { token: res.body.token }, transports: ['websocket', 'polling'] });
      await new Promise(r => socket.on('connect', r));

      socket.emit('room:join', { room: 'general' });
      await new Promise(r => setTimeout(r, 200));

      const rateLimitPromise = new Promise((resolve) => {
        socket.on('error:rate_limit', (err) => {
          resolve(err);
        });
      });

      // Send 7 messages rapidly
      for (let i = 1; i <= 7; i++) {
        socket.emit('message:send', { room: 'general', text: `Spam ${i}` });
      }

      const err = await rateLimitPromise;
      expect(err).toHaveProperty('retryAfter');
      expect(err.retryAfter).toBeGreaterThan(0);
      socket.close();
    }, 15000);
  });
});
