FROM node:20-bookworm

WORKDIR /app

# Cài dependencies trước (tận dụng Docker layer cache)
COPY package*.json ./
RUN npm ci

# Cài đặt Playwright browser binaries và các thư viện hệ thống Linux cần thiết
RUN npx playwright install --with-deps chromium

# Copy source code
COPY tsconfig.json ./
COPY src ./src

# Expose port
EXPOSE 3000

# Dev mode: hot reload với ts-node-dev
CMD ["npm", "run", "dev"]
