#!/bin/bash
# Autonome EC2 Deployment Script
# Run this script on your EC2 instance to deploy the application
# Uses NeonDB for database (external service)

set -e

echo "🚀 Autonome EC2 Deployment Script"
echo "=================================="

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "📦 Installing Docker..."
    sudo yum update -y 2>/dev/null || sudo apt-get update -y
    sudo yum install -y docker 2>/dev/null || sudo apt-get install -y docker.io
    sudo systemctl start docker
    sudo systemctl enable docker
    sudo usermod -aG docker $USER
    echo "✅ Docker installed. Please log out and back in, then run this script again."
    exit 0
fi

# Check if Docker Compose is installed
if ! command -v docker compose &> /dev/null; then
    echo "📦 Installing Docker Compose..."
    sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
    echo "✅ Docker Compose installed"
fi

# Create application directory
APP_DIR="/opt/autonome"
echo "📁 Setting up application directory at $APP_DIR..."
sudo mkdir -p $APP_DIR
sudo chown $USER:$USER $APP_DIR
cd $APP_DIR

# Check for .env.docker file
if [ ! -f ".env.docker" ]; then
    echo "⚠️  No .env.docker file found!"
    echo "Please create .env.docker with your configuration."
    echo "Required: DATABASE_URL (NeonDB), NIM_API_KEY, OPENROUTER_API_KEY, MISTRAL_API_KEY"
    echo "You can use .env.docker.example as a template."
    exit 1
fi

# Pull latest changes (if using git) or copy files
if [ -d ".git" ]; then
    echo "📥 Pulling latest changes..."
    git pull origin main
else
    echo "📋 Please copy your application files to $APP_DIR"
fi

# Build and start containers
echo "🐳 Building and starting container..."
docker compose --env-file .env.docker down 2>/dev/null || true
docker compose --env-file .env.docker up -d --build

# Wait for service to be healthy
echo "⏳ Waiting for service to start..."
sleep 10

# Check service status
echo "📊 Service Status:"
docker compose ps

echo ""
echo "✅ Deployment complete!"
echo "=================================="
echo "Application URL: http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || echo 'YOUR_EC2_IP'):3000"
echo ""
echo "Useful commands:"
echo "  docker compose logs -f app     # View application logs"
echo "  docker compose restart app     # Restart application"
echo "  docker compose down            # Stop the application"
