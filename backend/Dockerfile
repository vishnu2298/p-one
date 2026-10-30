FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
ENV NODE_ENV=production PORT=4000 DB_FILE=/data/connectly.db UPLOAD_DIR=/data/uploads
VOLUME /data
EXPOSE 4000
CMD ["node", "--no-warnings", "src/server.js"]
