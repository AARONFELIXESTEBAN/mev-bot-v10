# Terraform Configuration for MEV Bot V10 - Phase 2 GCP Infrastructure

provider "google" {
  project = var.gcp_project_id
  region  = var.gcp_region
}

variable "gcp_project_id" {
  description = "The GCP project ID."
  type        = string
}

variable "gcp_region" {
  description = "The GCP region for resources."
  type        = string
  default     = "us-central1"
}

variable "gce_zone" {
  description = "The GCP zone for the GCE VM."
  type        = string
  default     = "us-central1-a"
}

variable "gce_machine_type" {
  description = "The machine type for the GCE VM."
  type        = string
  default     = "e2-medium" # Cost-effective for initial deployment
}

variable "gce_image_family" {
  description = "The image family for the GCE VM."
  type        = string
  default     = "ubuntu-2004-lts"
}

variable "gce_image_project" {
  description = "The image project for the GCE VM."
  type        = string
  default     = "ubuntu-os-cloud"
}

variable "vm_name_bot" {
  description = "Name for the MEV Bot GCE VM."
  type        = string
  default     = "mev-bot-v10-vm"
}

variable "vm_name_mempool" {
  description = "Name for the Mempool Ingestion Service GCE VM."
  type        = string
  default     = "mempool-ingestion-vm"
}

resource "google_compute_instance" "mempool_ingestion_vm" {
  name         = var.vm_name_mempool
  machine_type = var.gce_machine_type
  zone         = var.gce_zone
  project      = var.gcp_project_id

  boot_disk {
    initialize_params {
      image = "${var.gce_image_project}/${var.gce_image_family}"
      size  = 50 # GB
    }
  }

  network_interface {
    network = "default" # Assumes default VPC network
    access_config {
      // Ephemeral IP for SSH access
    }
  }

  service_account {
    # Ensure this service account has permissions for:
    # - Logging (roles/logging.logWriter)
    # - Monitoring (roles/monitoring.metricWriter)
    # - Firestore (roles/datastore.user) - if mempool service writes directly
    # - Secret Manager (roles/secretmanager.secretAccessor) - if it fetches secrets
    email  = var.gcp_service_account_email # Define this variable
    scopes = ["cloud-platform"]
  }

  metadata_startup_script = fileexists("startup-script-mempool.sh") ? file("startup-script-mempool.sh") : null


  tags = ["mempool-ingestion-server"]

  allow_stopping_for_update = true
}

resource "google_compute_instance" "mev_bot_v10_vm" {
  name         = var.vm_name_bot
  machine_type = var.gce_machine_type
  zone         = var.gce_zone
  project      = var.gcp_project_id

  boot_disk {
    initialize_params {
      image = "${var.gce_image_project}/${var.gce_image_family}"
      size  = 50 # GB
    }
  }

  network_interface {
    network = "default" # Assumes default VPC network
    access_config {
      // Ephemeral IP for SSH access
    }
  }

  service_account {
    # Ensure this service account has permissions for:
    # - Logging (roles/logging.logWriter)
    # - Monitoring (roles/monitoring.metricWriter)
    # - Firestore (roles/datastore.user)
    # - KMS (roles/cloudkms.signerVerifier for the specific key)
    # - Secret Manager (roles/secretmanager.secretAccessor)
    # - GCP NBE (if specific role is needed beyond authenticated user)
    email  = var.gcp_service_account_email # Define this variable
    scopes = ["cloud-platform"]
  }

  metadata_startup_script = fileexists("startup-script-mevbot.sh") ? file("startup-script-mevbot.sh") : null


  tags = ["mev-bot-server"]

  allow_stopping_for_update = true
}

variable "gcp_service_account_email" {
  description = "The email of the service account to be used by GCE VMs."
  type        = string
}

# Firewall rule to allow internal traffic from mempool_ingestion_vm to mev_bot_v10_vm on publisher port
resource "google_compute_firewall" "allow_mempool_to_mevbot" {
  name    = "allow-mempool-to-mevbot"
  network = "default"
  project = var.gcp_project_id

  allow {
    protocol = "tcp"
    ports    = [var.mempool_publisher_port] # e.g., 3001
  }

  source_tags = ["mempool-ingestion-server"]
  target_tags = ["mev-bot-server"]
}

variable "mempool_publisher_port" {
  description = "The port the mempool ingestion service publishes on."
  type        = string
  default     = "3001"
}

# (Optional) Setup for GCP Secret Manager secrets if not done manually
# resource "google_secret_manager_secret" "rpc_mainnet_http" {
#   secret_id = "RPC_URL_MAINNET_HTTP"
#   project   = var.gcp_project_id
#   replication {
#     automatic = true
#   }
# }
# resource "google_secret_manager_secret_version" "rpc_mainnet_http_v1" {
#   secret      = google_secret_manager_secret.rpc_mainnet_http.id
#   secret_data = "YOUR_ACTUAL_RPC_URL_HERE" # Be careful with secrets in TF code
# }
# ... similar for other secrets like FLASHBOTS_SIGNING_KEY, KMS_KEY_PATH etc.
# Better to create secrets manually or via gcloud and grant SA access.

# Output VM instance details
output "mempool_ingestion_vm_ip" {
  value = google_compute_instance.mempool_ingestion_vm.network_interface[0].access_config[0].nat_ip
}
output "mev_bot_v10_vm_ip" {
  value = google_compute_instance.mev_bot_v10_vm.network_interface[0].access_config[0].nat_ip
}
