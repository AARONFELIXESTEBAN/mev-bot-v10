# Deployment Guide (Google Compute Engine - GCE)

This guide provides detailed steps for deploying the `MempoolIngestionService` and the `MevBot_V10` (Main Bot Orchestrator) to their respective Google Compute Engine (GCE) instances. It covers code transfer, dependency installation, PM2 process management setup, and verification procedures. This document references SSOT Section 7.2 (Deployment Environment - GCE) and Appendix D (GCE Instance Configuration Details).

## Table of Contents

1.  [Introduction](#introduction)
    *   [Prerequisites](#prerequisites)
    *   [Target Services and VMs](#target-services-vms)
2.  [General GCE VM Preparation (Common Steps)](#general-gce-vm-preparation)
    *   [SSH into GCE Instance](#ssh-into-gce-instance)
    *   [System Updates](#system-updates)
    *   [Install Common Dependencies](#install-common-dependencies)
        *   [Node.js and npm](#install-nodejs-npm)
        *   [Python and pip (if applicable)](#install-python-pip)
        *   [Git](#install-git)
        *   [PM2](#install-pm2)
    *   [Install Google Cloud CLI (gcloud)](#install-gcloud-cli)
    *   [Configure Google Cloud Authentication](#configure-gcloud-auth)
3.  [Deploying the MempoolIngestionService](#deploying-mempoolingestionservice)
    *   [VM Specifics (Refer to Appendix D)](#mempool-vm-specifics)
    *   [Code Transfer](#mempool-code-transfer)
    *   [Dependency Installation (Service Specific)](#mempool-dependency-installation)
    *   [Configuration Setup](#mempool-configuration-setup)
    *   [PM2 Configuration (`ecosystem.config.js`)](#mempool-pm2-configuration)
    *   [Starting the Service with PM2](#mempool-starting-service)
    *   [Verification](#mempool-verification)
4.  [Deploying the MevBot_V10 (Main Bot Orchestrator)](#deploying-mevbotv10)
    *   [VM Specifics (Refer to Appendix D)](#mevbot-vm-specifics)
    *   [Code Transfer](#mevbot-code-transfer)
    *   [Dependency Installation (Service Specific)](#mevbot-dependency-installation)
    *   [Configuration Setup](#mevbot-configuration-setup)
    *   [PM2 Configuration (`ecosystem.config.js`)](#mevbot-pm2-configuration)
    *   [Starting the Service with PM2](#mevbot-starting-service)
    *   [Verification](#mevbot-verification)
5.  [Post-Deployment & Maintenance](#post-deployment-maintenance)
    *   [Checking Logs with PM2](#checking-logs-pm2)
    *   [Monitoring PM2 Processes](#monitoring-pm2-processes)
    *   [Updating Code](#updating-code)
    *   [Startup Script (Ensuring PM2 restarts on boot)](#startup-script)
6.  [Troubleshooting](#troubleshooting)

## 1. Introduction

This guide is intended for DevOps personnel or developers responsible for deploying and managing the bot services on Google Compute Engine. It assumes that the GCE instances have been provisioned according to SSOT Appendix D.

### Prerequisites

*   GCE instances for `MempoolIngestionService` and `MevBot_V10` are created and accessible (refer to SSOT Appendix D for instance names, machine types, OS images, etc.).
*   SSH keys configured for accessing these GCE instances.
*   Source code for both services is available in a Git repository (e.g., GitHub, GitLab).
*   Necessary GCP IAM permissions for the user performing deployment and for the service accounts used by GCE instances (e.g., for GCS access, KMS access, Cloud Logging).
*   Familiarity with Linux command line, Git, Node.js (for PM2 and potentially MevBot_V10 if TypeScript), and Python (if MempoolIngestionService or other components are Python-based).

### Target Services and VMs

*   **MempoolIngestionService**: Deployed to its dedicated GCE VM (e.g., `gce-mempool-ingestion-vm-prod`).
*   **MevBot_V10 (Main Bot Orchestrator)**: Deployed to its dedicated GCE VM (e.g., `gce-mevbot-v10-vm-prod`).
    *   This VM will also host the Core Bot Services and other application-level services (Price, Opportunity ID, Simulation, Paper Trading) that `MevBot_V10` orchestrates, assuming they are part of the same codebase/deployment unit for MVP. If they are separate microservices, each would need similar deployment steps. This guide assumes `MevBot_V10` and its closely related services are deployed as a single application unit.

## 2. General GCE VM Preparation (Common Steps)

Perform these steps on **both** the `MempoolIngestionService` VM and the `MevBot_V10` VM unless specified otherwise.

### SSH into GCE Instance

Use the `gcloud` command or your preferred SSH client. Replace `INSTANCE_NAME` and `ZONE` accordingly.
```bash
gcloud compute ssh INSTANCE_NAME --zone=ZONE --project=YOUR_PROJECT_ID
# Example: gcloud compute ssh gce-mempool-ingestion-vm-prod --zone=us-central1-a --project=my-gcp-project
```

### System Updates

Ensure the system packages are up to date.
```bash
sudo apt update && sudo apt upgrade -y
```

### Install Common Dependencies

#### Node.js and npm
PM2 is a Node.js application. If `MevBot_V10` is TypeScript, it also needs Node.js.
```bash
# Install Node.js (e.g., LTS version, check PM2/project requirements)
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs
# Verify
node -v
npm -v
```

#### Python and pip (if applicable)
If any service or script is Python-based (e.g., potentially `MempoolIngestionService` or parts of `MevBot_V10`'s dependencies). GCE Linux images often come with Python3.
```bash
sudo apt-get install -y python3 python3-pip python3-venv
# Verify
python3 --version
pip3 --version
```

#### Git
For cloning the source code.
```bash
sudo apt-get install -y git
# Verify
git --version
```

#### PM2 (Process Manager for Node.js, also works for other languages)
```bash
sudo npm install pm2 -g
# Verify
pm2 --version
```

### Install Google Cloud CLI (gcloud)
Often pre-installed on GCE VMs. If not, or for a specific version:
```bash
echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" | sudo tee -a /etc/apt/sources.list.d/google-cloud-sdk.list
sudo apt-get install apt-transport-https ca-certificates gnupg -y
curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | sudo apt-key --keyring /usr/share/keyrings/cloud.google.gpg add -
sudo apt-get update && sudo apt-get install google-cloud-cli -y
```

### Configure Google Cloud Authentication
The GCE VM should ideally use its **service account** for GCP resource access (defined during VM creation, SSOT Appendix D). This service account needs appropriate IAM roles.
If `gcloud` needs to be used manually or for user-specific auth for setup:
```bash
gcloud auth login # Follow prompts if setting up with user credentials
gcloud config set project YOUR_PROJECT_ID
```
For applications, rely on Application Default Credentials (ADC) provided by the VM's service account.

## 3. Deploying the MempoolIngestionService

Perform these steps on the `gce-mempool-ingestion-vm-prod` (or equivalent name from SSOT Appendix D).

### VM Specifics (Refer to Appendix D)
Ensure the VM meets requirements for disk, memory, and CPU as outlined for the MempoolIngestionService.

### Code Transfer
1.  **Choose a deployment directory:**
    ```bash
    export DEPLOY_DIR="/opt/mempool_ingestion_service"
    sudo mkdir -p $DEPLOY_DIR
    sudo chown $USER:$USER $DEPLOY_DIR # Give current user ownership for clone
    cd $DEPLOY_DIR
    ```
2.  **Clone the repository:**
    Replace `YOUR_GIT_REPO_URL` with the actual URL. Use SSH or HTTPS.
    ```bash
    git clone YOUR_GIT_REPO_URL . # Clone into current directory
    # If using a specific branch or tag:
    # git checkout your-branch-or-tag
    ```

### Dependency Installation (Service Specific)
Assuming the `MempoolIngestionService` is Python-based as per earlier guides:
```bash
cd $DEPLOY_DIR
python3 -m venv .venv          # Create a virtual environment
source .venv/bin/activate     # Activate it
pip install -r requirements.txt # Install Python dependencies
# Deactivate if done for now: deactivate
```
If it's Node.js/TypeScript based:
```bash
cd $DEPLOY_DIR
npm install
# npm run build # If TypeScript, compile
```

### Configuration Setup
1.  Place necessary configuration files (e.g., `config.yaml`, `.env`) into the `$DEPLOY_DIR/config` or root directory as required by the service.
    *   **Sensitive data (API keys, etc.) in `.env` files should be handled securely.** Consider using GCP Secret Manager and fetching secrets at runtime (more advanced setup) or ensure `.env` files are protected with strict permissions and not committed to Git. For MVP, copying via secure channels might be used.
    ```bash
    # Example: scp user@local-machine:/path/to/.env $DEPLOY_DIR/.env
    # Ensure correct permissions
    sudo chmod 600 $DEPLOY_DIR/.env # Only owner can read/write
    ```
2.  Ensure paths in configuration files are correct for the GCE environment (e.g., paths to GCS buckets, log file locations if not using stdout).

### PM2 Configuration (`ecosystem.config.js`)
Create an `ecosystem.config.js` file in `$DEPLOY_DIR` for PM2.
Example for a Python service:
```javascript
// $DEPLOY_DIR/ecosystem.config.js
module.exports = {
  apps : [{
    name   : "mempool-ingestion-service",
    script : ".venv/bin/python", // Path to python in venv
    args   : "app/main.py",      // Main script for the service
    interpreter: "",             // Let script's shebang or PM2 decide for .py
    cwd    : __dirname,          // Current working directory
    env    : {
      "NODE_ENV": "production",  // Or other relevant env vars
      // "PYTHONUNBUFFERED": "1" // Useful for seeing logs immediately
    },
    // Restart strategy, logs, etc.
    autorestart: true,
    watch  : false, // Watch for file changes - disable in prod, handle updates via re-deploy
    max_memory_restart: '1G', // Example memory limit
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    error_file: '/var/log/pm2/mempool-ingestion-err.log', // Path for error logs
    out_file: '/var/log/pm2/mempool-ingestion-out.log',   // Path for output logs
    merge_logs: true
  }]
}
```
*   Adjust `script`, `args`, `interpreter` based on your service's entry point and language.
*   Ensure log directories exist or PM2 has rights to create them: `sudo mkdir -p /var/log/pm2 && sudo chown $USER:$USER /var/log/pm2` (or run PM2 as a user with write perms). For Cloud Logging, console output is preferred. Consider removing `error_file` and `out_file` if relying solely on Cloud Logging via `stdout/stderr`.

### Starting the Service with PM2
```bash
cd $DEPLOY_DIR
# If using Python venv, ensure PM2 uses it or activate it in the script path
# For Python, PM2 might pick up the venv if `script` points within it.
pm2 start ecosystem.config.js
```

### Verification
1.  **Check PM2 status:**
    ```bash
    pm2 list
    pm2 show mempool-ingestion-service
    ```
    Ensure status is `online`.
2.  **Check logs:**
    ```bash
    pm2 logs mempool-ingestion-service
    # Or check files if configured: tail -f /var/log/pm2/mempool-ingestion-out.log
    ```
3.  **Application-specific checks**:
    *   Verify it's connecting to mempool sources.
    *   Verify data is being written to GCS (if that's its role).
    *   Check Cloud Logging for structured logs.

## 4. Deploying the MevBot_V10 (Main Bot Orchestrator)

Perform these steps on the `gce-mevbot-v10-vm-prod` (or equivalent name from SSOT Appendix D).

### VM Specifics (Refer to Appendix D)
Ensure the VM meets requirements for the orchestrator and its bundled services.

### Code Transfer
Similar to MempoolIngestionService:
1.  **Choose a deployment directory:**
    ```bash
    export DEPLOY_DIR="/opt/mevbot_v10"
    sudo mkdir -p $DEPLOY_DIR
    sudo chown $USER:$USER $DEPLOY_DIR
    cd $DEPLOY_DIR
    ```
2.  **Clone the repository:**
    ```bash
    git clone YOUR_GIT_REPO_URL_FOR_MEVBOT .
    # git checkout your-branch-or-tag
    ```

### Dependency Installation (Service Specific)
Assuming `MevBot_V10` is TypeScript-based as per `MevBot_V10.ts`:
```bash
cd $DEPLOY_DIR
npm install      # Install Node.js dependencies
npm run build    # Compile TypeScript to JavaScript (e.g., into a 'dist' folder)
```
If it also includes Python components (Core Bot Services, etc.):
```bash
cd $DEPLOY_DIR # Or specific subdirectory for Python parts
python3 -m venv .venv_python
source .venv_python/bin/activate
pip install -r requirements_python.txt # Assuming a separate requirements for Python parts
# deactivate
```

### Configuration Setup
1.  Place necessary configuration files (e.g., `global_config.yaml`, `rpc_endpoints.yaml`, `.env`) into appropriate subdirectories (e.g., `$DEPLOY_DIR/configs`) or root as required.
    ```bash
    # Example: scp user@local-machine:/path/to/mevbot/.env $DEPLOY_DIR/.env
    # Ensure correct permissions
    sudo chmod 600 $DEPLOY_DIR/.env
    ```
2.  Ensure service account used by the VM has permissions for all services `MevBot_V10` interacts with (GCS, KMS, other GCP APIs).

### PM2 Configuration (`ecosystem.config.js`)
Create an `ecosystem.config.js` file in `$DEPLOY_DIR`.
Example for a TypeScript/Node.js service (assuming `build` outputs to `dist/main.js`):
```javascript
// $DEPLOY_DIR/ecosystem.config.js
module.exports = {
  apps : [{
    name   : "mevbot-v10-orchestrator",
    script : "dist/main.js", // Entry point of the compiled TypeScript application
    cwd    : __dirname,
    env    : {
      "NODE_ENV": "production",
      // Add other critical environment variables here if not using .env file loaded by app
    },
    autorestart: true,
    watch  : false,
    max_memory_restart: '2G', // Example, adjust based on needs
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    error_file: '/var/log/pm2/mevbot-err.log',
    out_file: '/var/log/pm2/mevbot-out.log',
    merge_logs: true
  }]
  // If Core Bot Services etc. are separate processes started from here, add them too.
  // However, the guide assumes MevBot_V10 orchestrates them in-process or they are libraries.
}
```
*   If `MevBot_V10` also starts Python sub-processes that need to be managed by PM2 independently, add their configurations here too.
*   Adjust log paths or remove if relying on Cloud Logging via console.

### Starting the Service with PM2
```bash
cd $DEPLOY_DIR
pm2 start ecosystem.config.js
```

### Verification
1.  **Check PM2 status:**
    ```bash
    pm2 list
    pm2 show mevbot-v10-orchestrator
    ```
2.  **Check logs:**
    ```bash
    pm2 logs mevbot-v10-orchestrator
    ```
3.  **Application-specific checks**:
    *   Verify it's connecting to CEX APIs, RPC nodes.
    *   Verify paper trades are being logged/recorded to GCS.
    *   Check P&L reporting (if any console output or via Data Collection).
    *   Check Cloud Logging and basic Cloud Monitoring dashboards.

## 5. Post-Deployment & Maintenance

### Checking Logs with PM2
```bash
pm2 logs APP_NAME             # Stream logs
pm2 logs APP_NAME --lines 100 # Last 100 lines
```

### Monitoring PM2 Processes
```bash
pm2 monit
```
This provides a dashboard for CPU/Memory usage of processes managed by PM2.

### Updating Code
1.  SSH into the VM.
2.  Navigate to the deployment directory (`$DEPLOY_DIR`).
3.  ```bash
    git pull                       # Pull latest changes
    # For Node.js/TS
    npm install                    # Install new/updated dependencies
    npm run build                  # Recompile if TypeScript
    # For Python
    # source .venv/bin/activate
    # pip install -r requirements.txt
    # deactivate
    pm2 restart APP_NAME           # Restart the application gracefully
    # Or pm2 reload APP_NAME for 0-second downtime reload (if app supports it)
    ```

### Startup Script (Ensuring PM2 restarts on boot)
PM2 can generate a startup script for your OS.
```bash
pm2 startup
# It will output a command that you need to run with sudo, for example:
# sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u youruser --hp /home/youruser
```
This ensures that if the VM reboots, PM2 will automatically restart and manage your saved processes.
Save current PM2 process list:
```bash
pm2 save
```

## 6. Troubleshooting

*   **Permission Denied**: Double-check file/directory ownership and permissions, especially for deployment directories, log files, and configuration files.
*   **Service Fails to Start**: Check `pm2 logs APP_NAME` and error logs (`error_file` in ecosystem config or Cloud Logging) for specific error messages. Common issues include missing dependencies, incorrect configuration paths, or problems in the application code.
*   **Cannot Connect to GCP Services**: Verify the GCE VM's service account has the correct IAM roles. Check network firewall rules if connecting to external services.
*   **Dependency Conflicts**: For Python, use virtual environments strictly. For Node.js, check `package-lock.json` or `yarn.lock`.
*   **PM2 Issues**: Consult PM2 documentation. Ensure Node.js and PM2 are compatible versions.

This guide provides a comprehensive approach to deploying the specified services to GCE. Adapt file paths, commands, and configurations based on the exact structure and language of your services.
```
