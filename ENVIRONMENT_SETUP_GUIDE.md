# Environment Setup Guide (Windows & GCP GCE)

This guide provides comprehensive instructions for setting up the development environment on both Windows workstations and Google Cloud Platform (GCP) Google Compute Engine (GCE) instances.

## Table of Contents

1.  [Windows Setup](#windows-setup)
    *   [Prerequisites](#windows-prerequisites)
    *   [Chocolatey Installation](#chocolatey-installation)
    *   [Git Installation](#git-installation)
    *   [Python Installation](#python-installation)
    *   [IDE Setup (VS Code)](#ide-setup-vs-code)
    *   [Google Cloud SDK Installation](#google-cloud-sdk-installation)
    *   [Project Initialization](#windows-project-initialization)
2.  [GCP GCE Setup](#gcp-gce-setup)
    *   [Prerequisites](#gcp-prerequisites)
    *   [GCE Instance Creation](#gce-instance-creation)
    *   [Connecting to GCE Instance](#connecting-to-gce-instance)
    *   [Software Installation on GCE](#software-installation-on-gce)
    *   [Project Initialization on GCE](#gce-project-initialization)
3.  [Common Configuration](#common-configuration)
    *   [Git Configuration](#git-configuration)
    *   [SSH Key Generation](#ssh-key-generation)
    *   [Environment Variables](#environment-variables)

## 1. Windows Setup

This section details the steps to set up the development environment on a Windows workstation.

### Windows Prerequisites

*   Windows 10 or later (Pro, Enterprise, or Education editions recommended for Hyper-V)
*   Administrator privileges on the Windows machine.
*   Stable internet connection.

### Chocolatey Installation

Chocolatey is a package manager for Windows. It simplifies software installation.

1.  **Open PowerShell as Administrator:**
    *   Search for "PowerShell" in the Start Menu.
    *   Right-click on "Windows PowerShell" and select "Run as administrator".
2.  **Run the installation script:**
    ```powershell
    Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
    ```
3.  **Verify installation:**
    Close and reopen PowerShell (as Administrator).
    ```powershell
    choco -v
    ```
    You should see the Chocolatey version number.

### Git Installation

Git is essential for version control.

1.  **Install Git using Chocolatey:**
    Open PowerShell as Administrator.
    ```powershell
    choco install git -y
    ```
2.  **Verify installation:**
    Close and reopen PowerShell.
    ```powershell
    git --version
    ```
    You should see the Git version number.

### Python Installation

Python is the primary programming language for this project. Refer to the SSOT document for the specific Python version.

1.  **Install Python using Chocolatey:**
    Open PowerShell as Administrator. Replace `PYTHON_VERSION` with the version specified in the SSOT (e.g., `3.10.7`).
    ```powershell
    choco install python --version=PYTHON_VERSION -y
    ```
    *Note: If the exact patch version is not available via Chocolatey, installing the latest minor version (e.g., 3.10.x) is usually acceptable. Confirm with project leads if unsure.*
2.  **Verify installation:**
    Close and reopen PowerShell.
    ```powershell
    python --version
    pip --version
    ```
    You should see the Python and pip version numbers.
3.  **(Optional but Recommended) Create a Virtual Environment:**
    It's good practice to use virtual environments for Python projects.
    ```powershell
    python -m venv .venv
    .\.venv\Scripts\activate
    ```
    Your PowerShell prompt should now be prefixed with `(.venv)`.

### IDE Setup (VS Code)

Visual Studio Code is the recommended IDE.

1.  **Install VS Code using Chocolatey:**
    Open PowerShell as Administrator.
    ```powershell
    choco install vscode -y
    ```
2.  **Install Recommended Extensions:**
    Open VS Code.
    ```
    code
    ```
    Go to the Extensions view (Ctrl+Shift+X) and install the following:
    *   `Python` (ms-python.python)
    *   `Pylance` (ms-python.vscode-pylance)
    *   `GitLens` (eamodio.gitlens)
    *   Refer to the SSOT document for any project-specific recommended VS Code extensions.

### Google Cloud SDK Installation

The Google Cloud SDK is needed to interact with GCP services.

1.  **Install Google Cloud SDK using Chocolatey:**
    Open PowerShell as Administrator.
    ```powershell
    choco install gcloudsdk -y
    ```
2.  **Initialize the SDK:**
    Close and reopen PowerShell.
    ```powershell
    gcloud init
    ```
    Follow the on-screen prompts:
    *   Log in with your Google account.
    *   Choose the GCP project to use (refer to SSOT for Project ID).
    *   Configure a default Compute Region and Zone (refer to SSOT or choose one geographically close to you, e.g., `us-central1` and `us-central1-a`).
3.  **Verify installation:**
    ```powershell
    gcloud --version
    ```
4.  **Install necessary components (if not installed by default):**
    ```powershell
    gcloud components install gke-gcloud-auth-plugin
    gcloud components install kubectl
    ```
    Refer to the SSOT for any other required gcloud components.

### Windows Project Initialization

1.  **Clone the Repository:**
    Open PowerShell or Git Bash. Navigate to your development directory (e.g., `C:\Users\YourUser\Projects`).
    Replace `REPOSITORY_URL` with the URL from the SSOT document.
    ```bash
    git clone REPOSITORY_URL
    cd <repository-name>
    ```
2.  **Install Project Dependencies:**
    Refer to the `README.md` or `requirements.txt` in the project repository. Typically:
    ```powershell
    # If using a virtual environment, ensure it's activated
    pip install -r requirements.txt
    ```

## 2. GCP GCE Setup

This section details the steps to set up the development environment on a Google Compute Engine instance. This is suitable for a consistent, cloud-based development or testing environment.

### GCP Prerequisites

*   A Google Cloud Platform account with billing enabled.
*   The Google Cloud SDK installed and initialized on your local machine (see Windows Setup).
*   Project ID and desired region/zone (refer to SSOT).

### GCE Instance Creation

Refer to the SSOT document for GCE instance naming conventions, machine type, disk size, and OS image.

1.  **Using `gcloud` command (from your local machine):**
    Replace placeholders with values from the SSOT or your requirements.
    ```bash
    gcloud compute instances create INSTANCE_NAME \
        --project=PROJECT_ID \
        --zone=ZONE \
        --machine-type=MACHINE_TYPE \
        --image-family=IMAGE_FAMILY \
        --image-project=IMAGE_PROJECT \
        --boot-disk-size=DISK_SIZE \
        --scopes=https://www.googleapis.com/auth/cloud-platform \
        --tags=http-server,https-server # Adjust tags as needed
    ```
    *   `INSTANCE_NAME`: e.g., `dev-instance-01`
    *   `PROJECT_ID`: Your GCP Project ID.
    *   `ZONE`: e.g., `us-central1-a`
    *   `MACHINE_TYPE`: e.g., `e2-medium`
    *   `IMAGE_FAMILY`: e.g., `ubuntu-2004-lts`
    *   `IMAGE_PROJECT`: e.g., `ubuntu-os-cloud`
    *   `DISK_SIZE`: e.g., `50GB`
2.  **Firewall Rules (if necessary):**
    If you need to access specific ports on your GCE instance from the internet (e.g., for a web server), create firewall rules.
    Example for allowing HTTP (80) and HTTPS (443):
    ```bash
    gcloud compute firewall-rules create allow-http --network=default --allow=tcp:80 --target-tags=http-server
    gcloud compute firewall-rules create allow-https --network=default --allow=tcp:443 --target-tags=https-server
    ```
    *Ensure your instance has the corresponding tags (`http-server`, `https-server`). Refer to the SSOT for project-specific firewall rules.*

### Connecting to GCE Instance

1.  **Using `gcloud`:**
    ```bash
    gcloud compute ssh INSTANCE_NAME --zone=ZONE --project=PROJECT_ID
    ```
    This command uses your local SSH keys and automatically handles authentication.

### Software Installation on GCE

Once connected to your GCE instance via SSH, install the necessary software. The following commands are for Debian/Ubuntu-based systems. Adjust for other distributions if necessary (refer to SSOT for the standard OS image).

1.  **Update Package List:**
    ```bash
    sudo apt update
    sudo apt upgrade -y
    ```
2.  **Install Git:**
    ```bash
    sudo apt install git -y
    git --version
    ```
3.  **Install Python (and pip, venv):**
    Refer to the SSOT for the specific Python version. Ubuntu LTS versions often come with a suitable Python version.
    ```bash
    sudo apt install python3 python3-pip python3-venv -y
    python3 --version
    pip3 --version
    ```
    If a specific version is required and not available via `apt`, you might need to compile from source or use a PPA (e.g., `deadsnakes`). This should be specified in the SSOT if necessary.
4.  **Install Google Cloud SDK (Optional, if interacting with other GCP services from GCE):**
    While the GCE instance itself has service account credentials, installing `gcloud` can be useful for manual operations or if specific user authentication is needed.
    ```bash
    echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" | sudo tee -a /etc/apt/sources.list.d/google-cloud-sdk.list
    sudo apt-get install apt-transport-https ca-certificates gnupg -y
    curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | sudo apt-key --keyring /usr/share/keyrings/cloud.google.gpg add -
    sudo apt-get update && sudo apt-get install google-cloud-sdk -y
    ```
    Then initialize if needed: `gcloud init`.
5.  **Install other project-specific dependencies:**
    Refer to the SSOT or project `README.md` for any other tools (e.g., Docker, database clients). Example for Docker:
    ```bash
    sudo apt install docker.io -y
    sudo systemctl start docker
    sudo systemctl enable docker
    sudo usermod -aG docker $USER # Add your user to the docker group
    # Log out and log back in for group changes to take effect
    ```

### GCE Project Initialization

1.  **Clone the Repository:**
    Navigate to your desired directory (e.g., `/home/your_user/projects`).
    Replace `REPOSITORY_URL` with the URL from the SSOT document.
    ```bash
    git clone REPOSITORY_URL
    cd <repository-name>
    ```
2.  **Create a Virtual Environment (Recommended):**
    ```bash
    python3 -m venv .venv
    source .venv/bin/activate
    ```
    Your shell prompt should now be prefixed with `(.venv)`.
3.  **Install Project Dependencies:**
    Refer to the `README.md` or `requirements.txt`.
    ```bash
    pip install -r requirements.txt
    ```

## 3. Common Configuration

These steps are applicable to both Windows and GCE environments after the initial setup.

### Git Configuration

Configure Git with your name and email. This is important for commit attribution.

```bash
git config --global user.name "Your Name"
git config --global user.email "youremail@example.com"
```
Replace "Your Name" and "youremail@example.com" with your actual details.

### SSH Key Generation

SSH keys are used for secure authentication with Git repositories (e.g., GitHub, GitLab) and other services.

1.  **Check for existing SSH keys:**
    *   Windows (Git Bash or PowerShell): `ls ~/.ssh`
    *   Linux (GCE): `ls ~/.ssh`
    Look for files like `id_rsa.pub` or `id_ed25519.pub`. If they exist, you can reuse them.
2.  **Generate a new SSH key (if needed):**
    We recommend using Ed25519 for better security.
    ```bash
    ssh-keygen -t ed25519 -C "youremail@example.com"
    ```
    *   Press Enter to accept the default file location (`~/.ssh/id_ed25519`).
    *   Enter a strong passphrase when prompted (recommended).
3.  **Add your SSH key to the SSH agent:**
    *   **Windows (Git Bash):**
        ```bash
        eval $(ssh-agent -s)
        ssh-add ~/.ssh/id_ed25519
        ```
    *   **Windows (PowerShell - requires OpenSSH client feature enabled):**
        ```powershell
        Start-SshAgent # May need to run: Set-Service ssh-agent -StartupType Automatic; Start-Service ssh-agent
        ssh-add ~\.ssh\id_ed25519
        ```
    *   **Linux (GCE):**
        ```bash
        eval $(ssh-agent -s)
        ssh-add ~/.ssh/id_ed25519
        ```
4.  **Add your public SSH key to your Git hosting service (e.g., GitHub):**
    *   Copy the public key content:
        *   Windows (Git Bash or PowerShell): `cat ~/.ssh/id_ed25519.pub`
        *   Linux (GCE): `cat ~/.ssh/id_ed25519.pub`
    *   Go to your Git hosting service's SSH key settings (e.g., GitHub > Settings > SSH and GPG keys > New SSH key).
    *   Paste the copied key content and save.

### Environment Variables

Refer to the SSOT document for a list of required environment variables (e.g., API keys, database credentials, `GOOGLE_APPLICATION_CREDENTIALS`).

*   **Windows (PowerShell - for current session):**
    ```powershell
    $env:VARIABLE_NAME = "value"
    ```
*   **Windows (PowerShell - persistently):**
    ```powershell
    [System.Environment]::SetEnvironmentVariable("VARIABLE_NAME", "value", "User")
    # Or "Machine" for system-wide. Requires admin rights. Restart PowerShell to see changes.
    ```
*   **Linux (GCE - for current session):**
    ```bash
    export VARIABLE_NAME="value"
    ```
*   **Linux (GCE - persistently for user):**
    Add `export VARIABLE_NAME="value"` to your `~/.bashrc` or `~/.profile` file.
    ```bash
    echo 'export VARIABLE_NAME="value"' >> ~/.bashrc
    source ~/.bashrc
    ```
*   **Project-specific `.env` files:**
    Many projects use `.env` files to manage environment variables locally. Check the project's `README.md` for instructions. Typically, you would create a `.env` file by copying a `.env.example` and filling in the values.
    Example `.env` file content:
    ```
    API_KEY="your_api_key"
    DATABASE_URL="your_database_url"
    ```
    Ensure `.env` files are listed in your `.gitignore` to prevent committing sensitive information.

---

This concludes the Environment Setup Guide. Refer to the SSOT document for any project-specific details or tool versions not explicitly mentioned here.
If you encounter any issues, please consult the troubleshooting section of the project documentation or contact the project lead.
```
