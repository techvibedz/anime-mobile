FROM node:20-bookworm-slim

# Install Chromium + fonts (Arabic + emoji for anime sites)
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    fonts-noto-cjk \
    fonts-dejavu-core \
    ca-certificates \
    dumb-init \
  && rm -rf /var/lib/apt/lists/*

ENV CHROME_BIN=/usr/bin/chromium
ENV NODE_ENV=production
ENV PORT=3001

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3001

# dumb-init so SIGTERM reaches both node + Chrome
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "index.js"]
