FROM node:18-alpine

WORKDIR /app

# Install dependencies for both React and the Bridge
COPY package*.json ./
RUN npm install --legacy-peer-deps
RUN npm install --legacy-peer-deps express axios cors compression
RUN cp node_modules/@pexip/components/dist/components.css node_modules/@pexip/components/dist/style.css 2>/dev/null || true

# Copy code and build the React app
COPY . .
ARG BASE_PATH=/assistant
RUN VITE_BASE=${BASE_PATH}/ npx vite build
RUN mkdir -p /app/data

# The command to run our bridge
ENV PORT=80
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:80${BASE_PATH}/ || exit 1
CMD ["node", "server.cjs"]