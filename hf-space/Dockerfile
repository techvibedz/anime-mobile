# Hugging Face Space — Docker SDK
# Builds by cloning the source repo and installing the Express + Puppeteer server.

FROM node:20-bookworm-slim

# Install Chromium + fonts + git
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    fonts-noto-cjk \
    fonts-dejavu-core \
    ca-certificates \
    dumb-init \
    git \
  && rm -rf /var/lib/apt/lists/*

# HF Spaces run as user with UID 1000.
# The node:20-bookworm-slim base already has a `node` user at UID 1000, so
# delete it first.
RUN userdel -r node 2>/dev/null || true \
 && useradd -m -u 1000 user \
 && mkdir -p /home/user/app \
 && chown -R user:user /home/user

USER user
ENV HOME=/home/user PATH=/home/user/.local/bin:$PATH
WORKDIR /home/user/app

# Pull the latest server code from GitHub at build time.
# (Re-trigger an HF Space "Factory Rebuild" to pick up new commits.)
ARG REPO_URL=https://github.com/techvibedz/anime-mobile.git
ARG REPO_REF=master
RUN git clone --depth 1 --branch ${REPO_REF} ${REPO_URL} src

WORKDIR /home/user/app/src/server
RUN npm ci --omit=dev

# HF Spaces expect the app on a port declared in README.md (`app_port`).
# We use 3001 to stay consistent with local dev.
ENV CHROME_BIN=/usr/bin/chromium
ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "index.js"]
