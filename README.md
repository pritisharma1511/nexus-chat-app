# NexusChat — Real-Time Distributed Chat Application

A production-grade, horizontally scalable real-time chat application built with **Node.js 20 (LTS)**, **Express**, **Socket.IO 4**, **Redis 7 (Alpine with AOF persistence)**, and **Nginx**, orchestrated seamlessly with **Docker Compose**.

---

## 1. Architecture Overview

```
                                      [ Clients / Browsers ]
                                                │
                                    (HTTP :8080 & WebSockets)
                                                ▼
                                    ┌───────────────────────┐
                                    │   Nginx Reverse Proxy │  (ip_hash sticky sessions,
                                    │      (Port 8080)      │   WebSocket upgrade headers)
                                    └───────────┬───────────┘
                                                │
                        ┌───────────────────────┼───────────────────────┐
                        │                       │                       │
                        ▼                       ▼                       ▼
             ┌─────────────────────┐ ┌─────────────────────┐ ┌─────────────────────┐
             │    App Replica 1    │ │    App Replica 2    │ │    App Replica 3    │
             │   (Node + Express)  │ │   (Node + Express)  │ │   (Node + Express)  │
             └──────────┬──────────┘ └──────────┬──────────┘ └──────────┬──────────┘
                        │                       │                       │
                        │        @socket.io/redis-adapter (Pub/Sub)     │
                        └───────────────────────┼───────────────────────┘
                                                │
                                                ▼
                                    ┌───────────────────────┐
                                    │   Redis 7 Container   │
                                    │  - Pub/Sub Adapter    │
                                    │  - AOF Persistence    │
                                    │  - Presence & History │
                                    │  - Atomic Rate Limit  │
                                    └───────────────────────┘
```

### Key Architectural Highlights
- **Horizontal Scaling via Redis Adapter**: WebSockets connected to different Node.js replicas broadcast and receive room events across the cluster using `@socket.io/redis-adapter`.
- **Sticky Sessions with Nginx**: `ip_hash` ensures consistent initial HTTP long-polling handshakes before upgrading to pure WebSockets.
- **Data Persistence**: Redis runs with `--appendonly yes` writing to a named Docker volume (`redis-data:/data`), ensuring chat history survives container restarts and upgrades.
- **Security & Isolation**: Redis is password-protected and contained purely within the internal Docker bridge network (`chat-net`) with **no exposed ports** to the host.
- **Non-Root Multi-Stage Dockerfile**: The Node.js application runs as the unprivileged `node` user in a hardened Alpine container.

---

## 2. Tech Stack

| Layer | Choice | Details |
|---|---|---|
| **Backend** | Node.js 20 (LTS) + Express | REST APIs, routing, health checks, JWT validation |
| **Realtime Engine** | Socket.IO 4 | WebSocket transport with fallback, event multiplexing |
| **Cluster Adapter** | `@socket.io/redis-adapter` | Multi-instance pub/sub synchronization |
| **Database & Cache** | Redis 7 (Alpine) | AOF persistence, room history, presence sets, rate limiting |
| **Auth** | JWT (`jsonwebtoken`) + `bcrypt` | 1-hour expiry, salt rounds 10, handshake token check |
| **Frontend** | Vanilla HTML5 / CSS3 / ES6 | Glassmorphism, modern dark theme, strict XSS protection |
| **Reverse Proxy** | Nginx Alpine | Reverse proxy, ip_hash sticky sessions, WebSocket headers |
| **Orchestration** | Docker Compose v2 | 3 app replicas, health checks, named persistent volume |
| **Testing** | Jest + `socket.io-client` | Full end-to-end integration test suite |

---

## 3. Redis Data Model

| Purpose | Redis Data Structure | Key Pattern | Details |
|---|---|---|---|
| **User Accounts** | Hash | `user:{username}` | `id`, `passwordHash`, `createdAt` |
| **Room Directory** | Set | `rooms` | Seeded with `general`, `random`, `tech` |
| **Message History** | List | `room:{roomId}:messages` | `RPUSH` with `LTRIM -1000 -1`; last 50 loaded on join |
| **Presence (Online)** | Set | `room:{roomId}:online` | `SADD` on join, `SREM` on leave/disconnect |
| **Socket Metadata** | Hash & Set | `socket:{socketId}`, `socket:{socketId}:rooms` | Tracks rooms per socket with 24h TTL for crash cleanup |
| **Rate Limiter** | String + TTL | `ratelimit:{username}` | `INCR` + `EXPIRE 10`; max 5 messages per 10s window |
| **Cluster Pub/Sub** | Pub/Sub channels | Socket.IO internal | Handled by `@socket.io/redis-adapter` |

### Message Format
```json
{
  "id": "e4f8d55c-6b3a-4be2-938b-d7be8df2bf6a",
  "room": "general",
  "user": "alice",
  "text": "Hello world from replica 1!",
  "ts": 1792563914150,
  "hostname": "4c0b071a40ac"
}
```

---

## 4. Socket Events Contract

### Client → Server
- `room:join` `{ room: "general" }` — Join channel room, register presence, receive message history.
- `room:leave` `{ room: "general" }` — Leave channel room, update presence.
- `message:send` `{ room: "general", text: "Hello" }` — Validate input, enforce rate limits, persist to Redis, broadcast to room.
- `typing:start` `{ room: "general" }` — Broadcast typing indicator to others in the room.
- `typing:stop` `{ room: "general" }` — Clear typing indicator for the user.

### Server → Client
- `room:history` `[messages]` — Last 50 messages formatted in chronological order.
- `message:new` `message` — Real-time message broadcast to all participants.
- `presence:update` `{ room, users: [...] }` — Updated array of online usernames in the room.
- `typing` `{ room, user, isTyping: true|false }` — Broadcasted to room members.
- `error:rate_limit` `{ retryAfter, message }` — Emitted when user exceeds 5 messages / 10s.
- `error:validation` `{ message }` — Emitted when message is empty or exceeds 1000 characters.

---

## 5. Quick Start (Single Command)

### Prerequisites
- Docker & Docker Compose installed.

### Steps
1. Clone the repository and enter the directory:
   ```bash
   cd chat-app
   ```

2. Copy the environment configuration:
   ```bash
   cp .env.example .env
   ```

3. Launch the complete cluster:
   ```bash
   docker compose up --build -d
   ```

4. Open your browser:
   - **Chat Application:** [http://localhost:8080](http://localhost:8080)
   - **Health Endpoint:** [http://localhost:8080/health](http://localhost:8080/health)

---

## 6. Environment Variables

| Variable | Default (Docker) | Default (Local Dev) | Description |
|---|---|---|---|
| `PORT` | `3000` | `3000` | Internal Node.js HTTP server port |
| `NGINX_PORT` | `8080` | `8080` | Exposed host port for Nginx proxy |
| `JWT_SECRET` | `change-me` | `change-me` | Secret key for signing and verifying auth tokens |
| `REDIS_HOST` | `redis` | `127.0.0.1` | Redis server hostname or IP address |
| `REDIS_PORT` | `6379` | `6379` | Redis server port |
| `REDIS_PASSWORD`| `change-me` | `change-me` | Redis password authentication |

---

## 7. Scaling App Replicas

To scale the Node.js application containers horizontally behind the Nginx reverse proxy, run:

```bash
docker compose up -d --scale app=5
```

Nginx automatically balances connections across all 5 app containers via `ip_hash`, and Redis Pub/Sub synchronizes all room messages and presence events in real time. Each message displays the `hostname` of the container that originated the event.

---

## 8. Running Automated Tests

The automated Jest test suite tests the live cluster through Nginx, covering authentication, Socket.IO handshakes, cross-room message broadcasts, history persistence, presence tracking, and rate limiting:

```bash
cd server
npm test
```

### Expected Output
```
PASS ../tests/chat.test.js
  NexusChat Real-Time Application Test Suite
    √ GET /health should return status: ok and redis: up
    Authentication REST Endpoints
      √ POST /api/register should create a new user and return JWT
      √ POST /api/register should reject duplicate username
      √ POST /api/register should reject invalid username or password
      √ POST /api/login should reject incorrect password
      √ POST /api/login should authenticate and return JWT with correct password
      √ GET /api/me should return user details with valid token
      √ GET /api/me should reject requests without token
      √ GET /api/rooms should return default room list
    Socket.IO Handshake Authentication
      √ Should reject connection when no token is provided
      √ Should successfully connect when valid token is provided
    Core Chat, History, and Message Validation
      √ Clients exchange messages and history is retrieved
      √ Validation: Empty or oversized messages trigger error:validation
    Presence Tracking & Cleanup
      √ Presence updates on join and removes user on disconnect
    Rate Limiting
      √ Emits error:rate_limit when user sends more than 5 messages per 10 seconds

Test Suites: 1 passed, 1 total
Tests:       15 passed, 15 total
```

---

## 9. Troubleshooting & Design Assumptions

### Port 80 on Windows
On Windows systems, port 80 is often reserved by the Windows Kernel `HTTP.sys` service (PID 4, `w3svc`). To guarantee out-of-the-box reliability without requiring system administrator alterations, `NGINX_PORT` is configured to `8080` by default. You can change `NGINX_PORT=80` in `.env` if port 80 is free on your machine.

### WebSocket Proxying in Nginx
If WebSocket connections fail through a reverse proxy, ensure:
1. `proxy_http_version 1.1;` is set.
2. `Upgrade $http_upgrade;` and `Connection $connection_upgrade;` are configured.
3. `proxy_read_timeout 3600s;` prevents proxy timeouts on long-lived idle WebSocket sessions.

### Redis Persistence Verification
To verify that chat history and users survive Redis restarts:
```bash
docker compose restart redis
```
Then refresh [http://localhost:8080](http://localhost:8080) — all users, channels, and message histories remain intact.

---

## 10. Verification of Acceptance Criteria

- [x] `docker compose up --build` starts Redis, 3 app replicas, and Nginx with no manual steps beyond copying `.env.example` to `.env`
- [x] Users on different app containers chat in the same room in real time (proven by host tags in message objects)
- [x] Last 50 messages appear on joining a room
- [x] Presence list updates correctly on join, leave, and abrupt disconnect
- [x] Rate limiting works (5 msgs / 10s) and displays friendly toast feedback
- [x] Redis is password-protected and not exposed to the host
- [x] Data survives a Redis container restart (AOF persistence)
- [x] No secrets committed; `.env` is git-ignored
- [x] All 15 automated Jest tests pass cleanly
