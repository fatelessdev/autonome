# Docker Deployment Guide

This guide covers deploying Autonome using Docker, both locally and on AWS EC2.

## Quick Start (Local Development)

```bash
# 1. Copy and configure environment variables
cp .env.docker.example .env.docker
# Edit .env.docker with your API keys

# 2. Start all services
docker compose --env-file .env.docker up -d

# 3. Run database migrations
docker compose exec app bun run db:migrate

# 4. Access the application
open http://localhost:3000
```

## Files Overview

| File | Purpose |
|------|---------|
| `Dockerfile` | Multi-stage build for the application |
| `docker-compose.yml` | Orchestrates app + PostgreSQL |
| `.dockerignore` | Excludes unnecessary files from build |
| `.env.docker.example` | Environment variable template |
| `scripts/deploy-ec2.sh` | Automated EC2 deployment script |

## Environment Variables

### Required Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `NIM_API_KEY` | NVIDIA NIM API key |
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `MISTRAL_API_KEY` | Mistral AI API key |

### Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LIGHTER_API_KEY_INDEX` | `2` | Lighter API key index |
| `LIGHTER_BASE_URL` | `https://mainnet.zklighter.elliot.ai` | Lighter API URL |
| `TRADING_MODE` | `simulated` | `live` or `simulated` |
| `SIM_INITIAL_CAPITAL` | `10000` | Simulator starting capital |
| `SIM_QUOTE_CURRENCY` | `USDT` | Quote currency |
| `SIM_REFRESH_INTERVAL_MS` | `30000` | Refresh interval |
| `VITE_APP_TITLE` | `Autonome` | Application title |

## EC2 Deployment

### Prerequisites

- AWS EC2 instance (Amazon Linux 2023 or Ubuntu 22.04 recommended)
- At least 1GB RAM, 10GB storage
- Security group allowing inbound traffic on ports 22 (SSH) and 3000 (App)
- NeonDB database with connection string

### Step-by-Step Deployment

#### 1. Launch EC2 Instance

```bash
# Recommended instance types:
# - t3.micro (1 vCPU, 1GB RAM) - minimum (free tier eligible)
# - t3.small (2 vCPU, 2GB RAM) - recommended
```

#### 2. Connect to EC2

```bash
ssh -i your-key.pem ec2-user@your-ec2-ip
# or for Ubuntu:
ssh -i your-key.pem ubuntu@your-ec2-ip
```

#### 3. Install Docker (Amazon Linux 2023)

```bash
sudo yum update -y
sudo yum install -y docker git
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker $USER

# Log out and back in for group changes
exit
# Reconnect via SSH
```

#### 4. Install Docker Compose

```bash
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
docker-compose --version
```

#### 5. Clone and Configure

```bash
# Clone repository
git clone https://github.com/your-repo/autonome.git /opt/autonome
cd /opt/autonome

# Create environment file
  cp .env.docker.example .env.docker
nano .env.docker  # Add your NeonDB URL and API keys
```

#### 6. Deploy

```bash
# Build and start
docker compose --env-file .env.docker up -d --build

# Check status
docker compose ps

# View logs
docker compose logs -f app
```

### Using the Deployment Script

Alternatively, use the automated script:

```bash
cd /opt/autonome
chmod +x scripts/deploy-ec2.sh
./scripts/deploy-ec2.sh
```

## Common Commands

```bash
# View logs
docker compose logs -f app

# Restart application
docker compose restart app

# Stop the application
docker compose down

# Rebuild and restart
docker compose up -d --build

# Shell into app container
docker compose exec app sh
```

## Production Considerations

### Security

1. **Use AWS Secrets Manager** for sensitive values
2. **Enable HTTPS** using a reverse proxy (nginx/Caddy)
3. **Restrict security group** to necessary IPs

### HTTPS with Caddy (Recommended)

```bash
# Install Caddy
sudo yum install -y caddy

# Configure Caddy
sudo tee /etc/caddy/Caddyfile << EOF
yourdomain.com {
    reverse_proxy localhost:3000
}
EOF

# Start Caddy
sudo systemctl enable --now caddy
```

### Monitoring

```bash
# Add to docker-compose.yml for monitoring
services:
  watchtower:
    image: containrrr/watchtower
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    command: --interval 86400  # Check for updates daily
```

### Database Backups

NeonDB provides automatic backups. You can also create manual backups from the Neon console at [console.neon.tech](https://console.neon.tech).

### Auto-restart on Reboot

The `restart: unless-stopped` policy in docker-compose.yml ensures containers restart automatically. Additionally, ensure Docker starts on boot:

```bash
sudo systemctl enable docker
```

## Troubleshooting

### Container won't start

```bash
# Check logs
docker compose logs app

# Check if port is in use
sudo lsof -i :3000
```

### Database connection issues

```bash
# Test NeonDB connection from your local machine
psql "your-neondb-connection-string"

# Check if the container can reach NeonDB
docker compose exec app wget -q --spider https://console.neon.tech && echo "Internet OK"
```

### Out of memory

```bash
# Check memory usage
docker stats

# Increase swap on EC2
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

### Build fails

```bash
# Clean build
docker compose down
docker system prune -af
docker compose up -d --build
```

## Architecture

```
┌─────────────────────────────────────────────┐
│                   EC2 Instance              │
│  ┌─────────────────────────────────────┐   │
│  │         Docker Container            │   │
│  │  ┌─────────────────────────────┐   │   │
│  │  │      Autonome (Bun)         │   │   │
│  │  │         :3000               │   │   │
│  │  └──────────────┬──────────────┘   │   │
│  └─────────────────┼───────────────────┘   │
│                    │                        │
└────────────────────┼────────────────────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
        ▼                         ▼
   HTTP/HTTPS              NeonDB (External)
    Traffic               PostgreSQL Cloud
```
