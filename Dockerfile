FROM node:20-alpine

WORKDIR /app

# Install dependencies (express, express-session, passport, passport-google-oauth20,
# knex, mysql2)
COPY package.json ./
RUN npm install

# Copy source files
COPY . .

# The app reads PORT at runtime (defaulting to 3000 if unset) and binds 0.0.0.0.
# It reads its MySQL connection from DATABASE_URL (a connection string, e.g.
# "mysql://user:password@host:3306/dbname" — see knexfile.js) and runs
# `knex.migrate.latest()` against it before listening. DATABASE_URL isn't
# required for the process to start, though: if it's unset or the database
# is unreachable, the server still starts and answers /health — only the
# MySQL-backed routes are affected until a working DATABASE_URL is provided.
ENV PORT=3000
EXPOSE 3000

# Health check hits the app's own /health endpoint on whatever PORT it bound.
HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=5 \
  CMD wget -q --spider "http://127.0.0.1:${PORT:-3000}/health" || exit 1

# Start the Express server (serves static Pong game + REST API + Google OAuth)
CMD ["node", "server.js"]
