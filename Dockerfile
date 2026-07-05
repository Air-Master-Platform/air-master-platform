# Air Master platform: Node web server + Python cargo engine in one image.
FROM node:20-slim

# System Python 3 + pip (the engine shells out to python3 via engine.js).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip python3-venv \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# --- Python deps (OR-Tools, numpy, pydantic) in an isolated venv ---
# We point PYTHON_BIN at the venv so engine.js spawns the right interpreter.
COPY engine/requirements.txt ./engine/requirements.txt
RUN python3 -m venv /opt/venv \
  && /opt/venv/bin/pip install --no-cache-dir -r engine/requirements.txt
ENV PYTHON_BIN=/opt/venv/bin/python3

# --- Node deps ---
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- App source ---
COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
