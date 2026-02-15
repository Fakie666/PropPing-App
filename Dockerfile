FROM node:20-alpine

RUN apk add --no-cache openssl

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --include=dev

COPY . .

RUN npm run db:generate
RUN npm run build

ENV NODE_ENV=production

EXPOSE 3000

CMD ["npm", "run", "start:prod"]
