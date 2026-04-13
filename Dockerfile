# Aria Dashboard - Dockerfile für Unraid
# Vereinfachter Build ohne externe Dependencies

FROM python:3.11-slim

WORKDIR /app

# Install system dependencies including Node.js
RUN apt-get update && apt-get install -y \
    nginx \
    supervisor \
    curl \
    gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g yarn \
    && rm -rf /var/lib/apt/lists/*

# Copy and install backend dependencies
COPY backend/requirements.txt /app/backend/
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

# Copy backend code
COPY backend/ /app/backend/

# Copy and build frontend
COPY frontend/package.json frontend/yarn.lock /app/frontend/
WORKDIR /app/frontend
RUN yarn install --frozen-lockfile
COPY frontend/ /app/frontend/
RUN yarn build

WORKDIR /app

# Create nginx config
RUN echo 'server { \n\
    listen 80; \n\
    server_name _; \n\
    \n\
    location / { \n\
        root /app/frontend/build; \n\
        index index.html; \n\
        try_files $uri $uri/ /index.html; \n\
    } \n\
    \n\
    location /api { \n\
        proxy_pass http://127.0.0.1:8001; \n\
        proxy_http_version 1.1; \n\
        proxy_set_header Upgrade $http_upgrade; \n\
        proxy_set_header Connection "upgrade"; \n\
        proxy_set_header Host $host; \n\
        proxy_set_header X-Real-IP $remote_addr; \n\
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; \n\
        proxy_set_header X-Forwarded-Proto $scheme; \n\
    } \n\
}' > /etc/nginx/sites-available/default

# Create supervisor config
RUN echo '[supervisord] \n\
nodaemon=true \n\
user=root \n\
\n\
[program:nginx] \n\
command=/usr/sbin/nginx -g "daemon off;" \n\
autostart=true \n\
autorestart=true \n\
\n\
[program:backend] \n\
command=python -m uvicorn server:app --host 0.0.0.0 --port 8001 \n\
directory=/app/backend \n\
autostart=true \n\
autorestart=true \n\
environment=PYTHONUNBUFFERED="1"' > /etc/supervisor/conf.d/aria.conf

# Create directories
RUN mkdir -p /var/log/supervisor /app/data

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 \
    CMD curl -f http://localhost/api/health || exit 1

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/supervisord.conf"]
