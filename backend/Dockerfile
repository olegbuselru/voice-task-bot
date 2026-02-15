FROM node:20-bullseye-slim

WORKDIR /app

# Prisma + HTTPS certs + ffmpeg
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .

RUN npx prisma generate
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

# Важно: миграции перед стартом
CMD sh -c "npx prisma migrate deploy && node dist/server.js"
