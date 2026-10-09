FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm i --omit=dev
COPY src ./src
USER node
ENV PORT=2567
EXPOSE 2567
HEALTHCHECK CMD wget -qO- http://localhost:2567/health || exit 1
CMD ["node","src/index.js"]
