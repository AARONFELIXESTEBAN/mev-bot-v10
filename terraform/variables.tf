# Terraform Variables

variable "gcp_project_id" {
  description = "The GCP project ID to deploy resources into."
  type        = string
  # No default, should be provided by user
}

variable "gcp_region" {
  description = "The GCP region for resources like GCE VMs."
  type        = string
  # Default is set in main.tf, can be overridden here or in tfvars
}

variable "gce_zone" {
  description = "The GCP zone for GCE VMs."
  type        = string
  # Default is set in main.tf, can be overridden here or in tfvars
}

variable "gce_machine_type" {
  description = "The machine type for GCE VMs."
  type        = string
  # Default is set in main.tf, can be overridden here or in tfvars
}

variable "gcp_service_account_email" {
  description = "The email of the service account to be used by GCE VMs. This service account must have necessary permissions (Firestore, KMS, Logging, Monitoring, Secret Manager Accessor)."
  type        = string
  # No default, should be provided by user
}

variable "mempool_publisher_port" {
  description = "The port the mempool ingestion service publishes on, to be allowed through firewall."
  type        = string
  # Default is set in main.tf, can be overridden here or in tfvars
}

# Add other variables used in main.tf without defaults if any were missed.
# For example, if image family/project were not given defaults:
# variable "gce_image_family" {}
# variable "gce_image_project" {}
# variable "vm_name_bot" {}
# variable "vm_name_mempool" {}
# However, these have defaults in the provided main.tf, so explicit declaration here is optional unless overriding.
