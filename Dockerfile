FROM node:20-alpine

WORKDIR /app

# openssl is required by Prisma's migration engine binaries on Alpine.
# (No C/C++ toolchain is needed here anymore — mysql2, the runtime MySQL
# driver, is pure JS with no native addon to compile.)
RUN apk add --no-cache openssl

# Install dependencies (express, express-session, passport,
# passport-google-oauth20, mysql2, prisma)
COPY package.json ./
RUN npm install

# Copy source files
COPY . .

# The app reads PORT at runtime (defaulting to 3000 if unset) and binds 0.0.0.0.
ENV PORT=3000
EXPOSE 3000

# Health check hits the app's own /health endpoint on whatever PORT it bound.
HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=5 \
  CMD wget -q --spider "http://127.0.0.1:${PORT:-3000}/health" || exit 1

# Start the Express server (serves static Pong game + REST API + Google OAuth).
# scripts/migrate.js applies the Prisma migration for user_preferences
# (prisma/migrations/) against DATABASE_URL (a MySQL 8.4 connection string)
# before the server binds a port — see db.js / scripts/migrate.js. The
# database itself is a separate service (see k8s/deployment.yaml or, for
# local/CI use, docker-compose) — this image has no embedded database.
CMD ["sh", "-c", "node scripts/migrate.js && node server.js"]
