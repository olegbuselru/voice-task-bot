FROM node:20-bullseye-slim

WORKDIR /app

# Prisma + HTTPS certs
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .

RUN npx prisma generate
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

# Apply pending migrations before server start
CMD sh -c "npx prisma migrate deploy && node dist/server.js"
