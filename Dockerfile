FROM node:20-slim

# Install yt-dlp + ffmpeg
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip ffmpeg && \
    pip3 install --break-system-packages yt-dlp && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --production
COPY server.js ./

EXPOSE 3000
CMD ["node", "server.js"]
