FROM node:22-alpine

RUN apk add --no-cache docker-cli

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3001
CMD ["npx", "tsx", "src/index.ts"]
