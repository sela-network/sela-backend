# Use Node.js 18 LTS (Alpine for smaller size)
FROM node:18-alpine

# Install build dependencies for native modules
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    libc6-compat

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (including dev dependencies for build)
RUN npm ci

# Copy source code
COPY src/ ./src/

# Copy Swagger documentation files
COPY swagger.yaml ./
COPY swagger-ui.html ./

# Build the hybrid server application
RUN npm run build:hybrid

# Remove dev dependencies after build to reduce image size
RUN npm prune --production

# Create data directory with proper permissions
RUN mkdir -p /app/data/redis && \
    chmod -R 755 /app/data

# Expose port
EXPOSE 8082

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8082/health || exit 1

# Start the hybrid server
CMD ["npm", "run", "start:hybrid"]
