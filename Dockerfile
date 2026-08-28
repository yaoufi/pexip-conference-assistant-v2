FROM node:18-alpine

WORKDIR /app

# Install dependencies for both React and the Bridge
COPY package*.json ./
RUN npm install
RUN npm install express axios cors compression

# Copy code and build the React app
COPY . .
RUN npx vite build

# The command to run our bridge
ENV PORT=80
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:80/assistant/ || exit 1
CMD ["node", "server.cjs"]