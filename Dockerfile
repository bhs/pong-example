FROM node:20-alpine

# Install native build tools required by better-sqlite3 (and bcrypt)
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Install dependencies first (cached layer)
COPY package.json ./
RUN npm install

# Copy the rest of the source
COPY . .

# Ensure the data directory exists for the SQLite database
RUN mkdir -p /app/data

EXPOSE 3000

# Health-check: wget is available on alpine
HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD wget -q --spider http://localhost:3000/health || exit 1

CMD ["node", "server.js"]
