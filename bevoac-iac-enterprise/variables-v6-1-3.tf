variable "enable_dedicated_admin_api" {
  description = "Deploy the isolated administration API runtime. It requires an approved private administration path."
  type        = bool
  default     = true
}

variable "admin_api_image" {
  description = "Optional immutable image for the isolated admin API. Defaults to api_image."
  type        = string
  default     = ""
}

variable "worker_min_replicas" {
  description = "Minimum worker replicas. Set to 0 to allow Managed Identity based Service Bus scale-to-zero, or 1 for warm availability."
  type        = number
  default     = 0

  validation {
    condition     = var.worker_min_replicas >= 0 && floor(var.worker_min_replicas) == var.worker_min_replicas
    error_message = "worker_min_replicas must be a non-negative integer."
  }
}

variable "worker_max_replicas" {
  description = "Maximum worker replicas for Service Bus queue scaling."
  type        = number
  default     = 8

  validation {
    condition     = var.worker_max_replicas >= max(1, var.worker_min_replicas) && floor(var.worker_max_replicas) == var.worker_max_replicas
    error_message = "worker_max_replicas must be an integer greater than or equal to max(1, worker_min_replicas)."
  }
}

variable "worker_queue_message_count" {
  description = "Service Bus active-message target per worker replica."
  type        = number
  default     = 1

  validation {
    condition     = var.worker_queue_message_count >= 1 && floor(var.worker_queue_message_count) == var.worker_queue_message_count
    error_message = "worker_queue_message_count must be an integer greater than or equal to 1."
  }
}

variable "service_bus_local_auth_enabled" {
  description = "Compatibility gate for the staged V6.1.3 migration. Keep true during workload cutover, then set false after all workloads use Managed Identity."
  type        = bool
  default     = true
}

variable "retain_legacy_servicebus_connection_secret" {
  description = "Keep the legacy Service Bus connection-string Key Vault secret during rollback-compatible cutover. Set false only after Managed Identity smoke tests and traffic promotion."
  type        = bool
  default     = true
}

variable "retain_legacy_api_admin_secret_reader" {
  description = "Keep the public API legacy access to admin-api-secret during rollback-compatible cutover. Set false only after the dedicated admin API is validated and legacy API revisions are no longer rollback candidates."
  type        = bool
  default     = true
}

variable "retain_legacy_containerapp_rollback_compatibility" {
  description = "Keep legacy pg-password references and legacy workload identities at Container Apps application scope until old revisions are retired. Set false only in the security-finalize phase."
  type        = bool
  default     = true
}

variable "key_vault_public_network_access_enabled" {
  description = "Key Vault public network state. Defaults preserve the pre-V6.1.3 public posture; the release runner snapshots live Azure for workload migration and disables it during private-endpoint finalization."
  type        = bool
  default     = true
}

variable "key_vault_network_bypass" {
  description = "Key Vault network ACL bypass value. The release runner snapshots the live value during workload migration and sets None for security finalization."
  type        = string
  default     = "None"

  validation {
    condition     = contains(["None", "AzureServices"], var.key_vault_network_bypass)
    error_message = "key_vault_network_bypass must be None or AzureServices."
  }
}

variable "key_vault_network_default_action" {
  description = "Key Vault network ACL default action. Defaults preserve the pre-V6.1.3 public posture; the release runner snapshots live Azure for workload migration and sets Deny for security finalization."
  type        = string
  default     = "Allow"

  validation {
    condition     = contains(["Allow", "Deny"], var.key_vault_network_default_action)
    error_message = "key_vault_network_default_action must be Allow or Deny."
  }
}

variable "key_vault_ip_rules" {
  description = "Key Vault public IP rules preserved during workload migration and cleared during private-endpoint finalization."
  type        = set(string)
  default     = []
}

variable "key_vault_virtual_network_subnet_ids" {
  description = "Key Vault virtual network ACL rules preserved during workload migration and cleared during private-endpoint finalization."
  type        = set(string)
  default     = []
}

variable "api_revision_suffix" {
  description = "Unique suffix for the candidate public API revision. The gated deployment script sets this value for production releases."
  type        = string
  default     = ""

  validation {
    condition     = var.api_revision_suffix == "" || can(regex("^[a-z][a-z0-9-]{0,62}[a-z0-9]$", var.api_revision_suffix))
    error_message = "api_revision_suffix must be empty or a lower-case Container Apps revision suffix."
  }
}

variable "api_stable_revision_suffix" {
  description = "Suffix of the currently stable public API revision. When set, Terraform pins 100 percent traffic to this revision and creates the candidate at 0 percent."
  type        = string
  default     = ""

  validation {
    condition     = var.api_stable_revision_suffix == "" || can(regex("^[a-z0-9][a-z0-9-]{0,63}$", var.api_stable_revision_suffix))
    error_message = "api_stable_revision_suffix must be empty or a valid Container Apps revision suffix."
  }
}

variable "retain_legacy_broad_key_vault_roles" {
  description = "Temporary migration switch. Keep the existing vault-wide API/worker readers during the workload rollout; set false only in the security-finalize phase after all workload secret references are verified."
  type        = bool
  default     = true
}

variable "retain_legacy_api_servicebus_sender" {
  description = "Temporary migration switch. Keep the existing public-API Service Bus Sender role during the workload rollout; set false only in the security-finalize phase after the dedicated outbox sender is verified."
  type        = bool
  default     = true
}
