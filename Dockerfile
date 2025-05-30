# Use Node.js LTS version
FROM node:20-slim

# Create app directory
WORKDIR /usr/src/app

# Copy both package.json files
COPY backend/package*.json ./backend/
COPY mcp-server/package*.json ./mcp-server/

# Install dependencies for both services
WORKDIR /usr/src/app/backend
RUN npm install

WORKDIR /usr/src/app/mcp-server
RUN npm install

# Copy source code for both services
WORKDIR /usr/src/app
COPY backend ./backend
COPY mcp-server ./mcp-server

# Build both TypeScript projects
WORKDIR /usr/src/app/backend
RUN npm run build

WORKDIR /usr/src/app/mcp-server
RUN npm run build

# Set working directory back to backend
WORKDIR /usr/src/app/backend

# Expose port
EXPOSE 3000

# Start the application
CMD ["npm", "start"] 