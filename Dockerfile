FROM node:20-alpine

WORKDIR /app

# Install dependencies (express, express-session, passport,
# passport-google-oauth20, better-sqlite3). better-sqlite3 compiles a small
# native addon at install time; Alpine (musl) needs python3/make/g++ present
# for node-gyp when a prebuilt binary isn't available for this platform —
# installed as a virtual package group so it can be dropped afterwards to
# keep the final image small.
COPY package.json ./
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
  && npm install \
  && apk del .build-deps

# Copy source files
COPY . .

# The app reads PORT at runtime (defaulting to 3000 if unset) and binds 0.0.0.0.
ENV PORT=3000
EXPOSE 3000

# Style preferences are persisted to a SQLite file on disk (see db.js).
# Mount a volume at /app/data (and set DB_PATH accordingly) in production so
# preferences survive container restarts — see k8s/deployment.yaml.
VOLUME ["/app/data"]

# Health check hits the app's own /health endpoint on whatever PORT it bound.
HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=5 \
  CMD wget -q --spider "http://127.0.0.1:${PORT:-3000}/health" || exit 1

# Start the Express server (serves static Pong game + REST API + Google OAuth)
CMD ["node", "server.js"]
