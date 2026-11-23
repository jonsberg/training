FROM node:24-bookworm-slim

WORKDIR /app
RUN mkdir -p /app/data /app/init && chown node:node /app/data
COPY package.json .
COPY src/ ./src/

USER node
ENTRYPOINT ["node"]
CMD ["src/index.ts"]
