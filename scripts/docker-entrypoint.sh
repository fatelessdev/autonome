#!/bin/sh
set -e

echo "🚀 Starting Autonome..."

# Wait for database to be ready
echo "⏳ Waiting for database connection..."
until bun run db:migrate 2>/dev/null; do
  echo "Database not ready, waiting..."
  sleep 2
done

echo "✅ Database migrations completed"

# Start the application
echo "🎯 Starting application server..."
exec bun .output/server/index.mjs
