FROM node:20-alpine

WORKDIR /app

# Install dependencies (express, express-session, passport, passport-google-oauth20)
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

# Start the Express server (serves static Pong game + REST API + Google OAuth)
CMD ["node", "server.js"]
