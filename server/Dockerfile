# Stage 1: Install production dependencies
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --omit=dev

# Stage 2: Production runtime
FROM node:20-alpine

WORKDIR /usr/src/app

# Install curl for Docker HEALTHCHECK
RUN apk add --no-cache curl

# Copy production dependencies from builder stage
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY package*.json ./
COPY src/ ./src/
COPY client/ ./client/

# Ensure non-root node user owns application files
RUN chown -R node:node /usr/src/app

USER node

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "src/index.js"]
