FROM node:20-alpine

WORKDIR /app

# python3/make/g++ are needed so `npm install` can build better-sqlite3's
# native addon on Alpine (musl) when no prebuilt binary matches this image's
# platform/arch. Kept in the final image (small footprint) rather than
# stripped out afterward, since better-sqlite3 may need to rebuild again on
# a subsequent `npm install` (e.g. after a base image update). openssl is
# required by Prisma's migration engine binaries on Alpine.
RUN apk add --no-cache python3 make g++ openssl

# Install dependencies (express, express-session, passport,
# passport-google-oauth20, better-sqlite3, prisma)
COPY package.json ./
RUN npm install

# Copy source files
COPY . .

# Directory for the persistent SQLite preferences database. Mount a volume
# here in production (see k8s/deployment.yaml) so preferences survive pod
# restarts/rescheduling.
RUN mkdir -p /app/data
VOLUME ["/app/data"]

# The app reads PORT at runtime (defaulting to 3000 if unset) and binds 0.0.0.0.
ENV PORT=3000
# Default on-disk location for the style-preferences SQLite database.
ENV SQLITE_PATH=/app/data/preferences.sqlite3
EXPOSE 3000

# Health check hits the app's own /health endpoint on whatever PORT it bound.
HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=5 \
  CMD wget -q --spider "http://127.0.0.1:${PORT:-3000}/health" || exit 1

# Start the Express server (serves static Pong game + REST API + Google OAuth).
# scripts/migrate.js applies the Prisma migration for user_preferences
# (prisma/migrations/) against SQLITE_PATH before the server binds a port —
# see db.js / scripts/migrate.js for why the schema is no longer created
# ad-hoc at boot.
CMD ["sh", "-c", "node scripts/migrate.js && node server.js"]
