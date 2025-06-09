#!/bin/bash
# Startup script for Mempool Ingestion Service VM

echo "Starting startup script for Mempool Ingestion Service VM..."

# Update and install dependencies
sudo apt-get update -y
echo "APT update done."
sudo apt-get upgrade -y
echo "APT upgrade done."
sudo apt-get install -y git curl software-properties-common
echo "Installed git, curl, software-properties-common."

# Install Node.js (LTS)
echo "Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs
echo "Node.js installed."
node -v
npm -v

# Install PM2
echo "Installing PM2..."
sudo npm install pm2 -g
echo "PM2 installed."

# Install Google Cloud Logging Agent (Ops Agent)
echo "Installing Google Cloud Ops Agent..."
curl -sSO https://dl.google.com/cloudagents/add-google-cloud-ops-agent-repo.sh
sudo bash add-google-cloud-ops-agent-repo.sh --also-install
sudo systemctl start google-cloud-ops-agent
echo "Google Cloud Ops Agent installed and started."

# --- Application Specific Setup ---
# The following steps are examples. Adjust them based on your actual deployment strategy.
# Option 1: Clone and build on VM (ensure VM service account has repo access if private)
# Option 2: Use a custom GCE image with the application pre-built.
# Option 3: Deploy pre-built artifacts from a GCS bucket.

# Example for Option 1:
# APP_DIR="/opt/app/mempool-ingestion"
# GIT_REPO_URL="YOUR_MEMPOOL_INGESTION_SERVICE_REPO_URL" # Replace with your repo URL

# echo "Cloning application repository from $GIT_REPO_URL to $APP_DIR..."
# sudo mkdir -p $APP_DIR
# sudo chown $(whoami):$(whoami) $APP_DIR # Or the user PM2 will run as
# git clone $GIT_REPO_URL $APP_DIR
# cd $APP_DIR

# echo "Installing application dependencies..."
# npm install --production # Only install production dependencies

# echo "Building application..."
# npm run build

# echo "Creating .env file (example - fetch from Secret Manager or GCS in a real scenario)"
# cat << EOF > .env
# LOG_LEVEL=info
# NODE_ENV=production
# MEMPOOL_WS_URL=YOUR_PRODUCTION_MEMPOOL_WS_URL # Fetch this from Secret Manager
# PUBLISHER_PORT=3001
# # Add other necessary production environment variables
# EOF

# echo "Starting application with PM2..."
# pm2 start dist/main.js --name mempool-ingestion-svc --time
# pm2 save # Persist PM2 process list

echo "Mempool Ingestion VM startup script finished."
# Note: PM2 startup (pm2 startup systemd -u youruser) should be done manually after first setup
# or baked into a custom image to ensure PM2 itself restarts on boot.
# This script primarily handles initial setup.
```
