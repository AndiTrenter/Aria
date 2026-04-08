# Aria Dashboard - Dockerfile für Unraid
# Multi-stage build für optimale Image-Größe

# Stage 1: Build Frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

# Copy package files (yarn.lock is optional)
COPY frontend/package.json ./
COPY frontend/yarn.lock* ./

# Install dependencies
RUN yarn install

# Copy source
COPY frontend/ ./

# Build
ARG REACT_APP_BACKEND_URL=""
ENV REACT_APP_BACKEND_URL=${REACT_APP_BACKEND_URL}
RUN yarn build

# Stage 2: Build Final Image
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    nginx \
    supervisor \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy backend requirements and install
COPY backend/requirements.txt /app/backend/
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

# Copy backend code
COPY backend/ /app/backend/

# Copy built frontend
COPY --from=frontend-builder /app/frontend/build /app/frontend/build

# Create nginx config
RUN echo 'server { \n\
    listen 80; \n\
    server_name _; \n\
    \n\
    # Frontend \n\
    location / { \n\
        root /app/frontend/build; \n\
        index index.html; \n\
        try_files $uri $uri/ /index.html; \n\
    } \n\
    \n\
    # Backend API \n\
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
stdout_logfile=/var/log/supervisor/nginx.log \n\
stderr_logfile=/var/log/supervisor/nginx_err.log \n\
\n\
[program:backend] \n\
command=python -m uvicorn server:app --host 0.0.0.0 --port 8001 \n\
directory=/app/backend \n\
autostart=true \n\
autorestart=true \n\
stdout_logfile=/var/log/supervisor/backend.log \n\
stderr_logfile=/var/log/supervisor/backend_err.log \n\
environment=PYTHONUNBUFFERED="1"' > /etc/supervisor/conf.d/aria.conf

# Create log directory
RUN mkdir -p /var/log/supervisor

# Create data directory for MongoDB (if using external)
RUN mkdir -p /app/data

# Expose port
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost/api/health || exit 1

# Start supervisor
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/supervisord.conf"]
