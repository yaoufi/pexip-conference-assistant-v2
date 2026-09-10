FROM node:18-alpine@sha256:929b04d7c782f04f615cf785488fed452b6569f87c73ff666ad553a7554f0006

WORKDIR /app

COPY package*.json ./
RUN npm ci --legacy-peer-deps
RUN cp node_modules/@pexip/components/dist/components.css node_modules/@pexip/components/dist/style.css 2>/dev/null || true

COPY . .
ARG BASE_PATH=/assistant
RUN VITE_BASE=${BASE_PATH}/ npx vite build
RUN mkdir -p /app/data && chown -R node:node /app

USER node

ENV PORT=3001
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001${BASE_PATH}/ || exit 1
CMD ["node", "server.cjs"]
