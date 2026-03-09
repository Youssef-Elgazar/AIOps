FROM node:20-alpine

WORKDIR /app

# sql.js is pure JS — no C++ build tools needed
COPY package*.json ./
RUN npm ci --only=production

COPY . .

RUN mkdir -p storage/logs

EXPOSE 3000

CMD ["node", "src/server.js"]