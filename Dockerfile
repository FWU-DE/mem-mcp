# syntax=docker/dockerfile:1.7

# --- Build stage ---
FROM node:22-alpine AS builder
WORKDIR /app

# Install all deps (incl. dev) for the TypeScript build.
# --ignore-scripts skips the `prepare` hook; we run the build explicitly below.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- Runtime stage ---
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Production deps only. Skip scripts — `prepare` would invoke tsc, which is a dev dep.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=builder /app/build ./build

# Drop privileges.
USER node

EXPOSE 3000

# Basic liveness: is the port open? (HTTP 400 for GET /mcp without session is expected.)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+ (process.env.PORT||3000) +'/mcp', r => process.exit(0)).on('error', () => process.exit(1))"

CMD ["node", "build/index.js", "--http"]
