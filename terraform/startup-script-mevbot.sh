#!/bin/bash
# Startup script for MEV Bot V10 VM

echo "Starting startup script for MEV Bot V10 VM..."

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
# Similar to the mempool service, choose your deployment strategy.
# Example for Option 1 (Clone and Build):
# APP_DIR="/opt/app/mev-bot-v10"
# GIT_REPO_URL="YOUR_MEV_BOT_V10_REPO_URL" # Replace with your repo URL

# echo "Cloning application repository from $GIT_REPO_URL to $APP_DIR..."
# sudo mkdir -p $APP_DIR
# sudo chown $(whoami):$(whoami) $APP_DIR
# git clone $GIT_REPO_URL $APP_DIR
# cd $APP_DIR

# echo "Installing application dependencies..."
# npm install --production

# echo "Building application..."
# npm run build

# echo "Creating .env file (example - fetch from Secret Manager or GCS for production)"
# # Ensure the VM's service account has access to these secrets in Secret Manager
# # PROJECT_ID=$(gcloud config get-value project) # Or get from metadata server
# # cat << EOF > .env
# # LOG_LEVEL=info
# # NODE_ENV=production
# # GCP_PROJECT_ID=${PROJECT_ID}
# # RPC_URL_MAINNET_HTTP=\$(gcloud secrets versions access latest --secret=RPC_URL_MAINNET_HTTP --project=${PROJECT_ID})
# # RPC_URL_MAINNET_WSS=\$(gcloud secrets versions access latest --secret=RPC_URL_MAINNET_WSS --project=${PROJECT_ID})
# # GCP_KMS_KEY_PATH=\$(gcloud secrets versions access latest --secret=GCP_KMS_KEY_PATH --project=${PROJECT_ID})
# # MEMPOOL_PUBLISHER_URL=ws://INTERNAL_IP_OF_MEMPOOL_VM:3001 # Replace with actual internal IP/DNS
# # FLASHBOTS_SIGNING_KEY=\$(gcloud secrets versions access latest --secret=FLASHBOTS_SIGNING_KEY --project=${PROJECT_ID})
# # # Add other necessary production environment variables
# # EOF

# echo "Starting application with PM2..."
# pm2 start dist/main.js --name mev-bot-v10-orchestrator --time
# pm2 save

echo "MEV Bot V10 VM startup script finished."
# Note: PM2 startup (pm2 startup systemd -u youruser) should be done manually after first setup
# or baked into a custom image.
```
