FROM node:20-alpine

WORKDIR /app

# Install dependencies (including express)
COPY package.json ./
RUN npm install

# Copy source files
COPY . .

EXPOSE 3000

# Start the Express server (serves static Pong game + REST API)
CMD ["node", "server.js"]
