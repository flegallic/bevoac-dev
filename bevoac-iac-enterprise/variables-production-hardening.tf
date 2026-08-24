
variable "release_security_profile" {
  description = "Release security profile. Use controlled_production for V6.2.0 and enterprise_network only with the V7 pack."
  type        = string
  default     = "legacy_migration"

  validation {
    condition     = contains(["legacy_migration", "controlled_production", "enterprise_network"], var.release_security_profile)
    error_message = "release_security_profile must be legacy_migration, controlled_production or enterprise_network."
  }
}

variable "key_vault_allow_container_apps_egress" {
  description = "Add the fixed Container Apps NAT egress IP to the Key Vault firewall while public access remains enabled."
  type        = bool
  default     = false
}
variable "enable_service_bus_sessions" {
  description = "Enable Service Bus sessions for tenant-level fair scheduling. Changing this recreates the queue."
  type        = bool
  default     = true
}

variable "enable_postgres_public_access" {
  description = "Production should set false with enable_private_endpoints=true. POC can keep true."
  type        = bool
  default     = false
}

variable "enable_private_endpoints" {
  description = "Create private endpoints and private DNS for PostgreSQL and Key Vault."
  type        = bool
  default     = true
}

variable "admin_auth_mode" {
  description = "Production admin auth mode. Use oidc in production."
  type        = string
  default     = "oidc"

  validation {
    condition     = contains(["oidc", "shared_secret"], var.admin_auth_mode)
    error_message = "admin_auth_mode must be oidc or shared_secret."
  }
}

variable "admin_oidc_issuer" {
  type    = string
  default = ""
}

variable "admin_oidc_audience" {
  type    = string
  default = ""
}

variable "admin_oidc_tenant_id" {
  description = "Microsoft Entra tenant ID authorized to issue administrator tokens."
  type        = string
  default     = ""

  validation {
    condition     = var.admin_oidc_tenant_id == "" || can(regex("^[0-9a-fA-F-]{36}$", var.admin_oidc_tenant_id))
    error_message = "admin_oidc_tenant_id must be empty or a UUID."
  }
}

variable "admin_oidc_required_roles" {
  type    = string
  default = "Bevoac.Admin"
}

variable "active_scan_limits" {
  description = "Backpressure active scan limits by plan."
  type = object({
    free     = number
    standard = number
    business = number
    payg     = number
  })
  default = {
    free     = 1
    standard = 3
    business = 10
    payg     = 10
  }
}

variable "max_result_json_bytes" {
  type    = number
  default = 8388608
}

variable "pdf_generation_timeout_ms" {
  type    = number
  default = 20000
}

variable "pdf_max_input_json_bytes" {
  type    = number
  default = 5242880
}

variable "max_concurrent_tenant_sessions" {
  type    = number
  default = 4
}

variable "log_retention_days" {
  type    = number
  default = 90
}

variable "monitor_action_group_id" {
  description = "Optional Azure Monitor action group ID for production alerts."
  type        = string
  default     = ""
}

variable "enable_retention_scheduler" {
  description = "Deploy a scheduled Container Apps Job that runs scripts/retention-sweep.js."
  type        = bool
  default     = true
}

variable "retention_cron_expression" {
  description = "Cron expression for retention sweep. Default: daily at 03:15 UTC."
  type        = string
  default     = "15 3 * * *"
}

variable "retention_done_days" {
  type    = number
  default = 180
}

variable "retention_failed_days" {
  type    = number
  default = 90
}

variable "enable_apim_gateway" {
  description = "Deploy Azure API Management in front of the API. Optional for POC, recommended for B2B pilots."
  type        = bool
  default     = false
}

variable "apim_subscription_required" {
  description = "When true, APIM requires Ocp-Apim-Subscription-Key in addition to Bevoac Authorization Bearer API key. Recommended when APIM is used as a partner gateway."
  type        = bool
  default     = true
}

variable "apim_sku_name" {
  type    = string
  default = "Consumption_0"
}

variable "apim_publisher_name" {
  type    = string
  default = "Bevoac"
}

variable "apim_publisher_email" {
  type    = string
  default = "security@bevoac.fr"
}

variable "monitor_notification_email" {
  description = "Operational email used when Terraform creates the Bevoac Action Group. Leave empty only when monitor_action_group_id references an existing group."
  type        = string
  default     = ""
}

variable "require_production_monitoring" {
  description = "Fail a production plan when neither an existing Action Group nor a notification email is configured."
  type        = bool
  default     = true
}

variable "enable_monitoring_diagnostics" {
  description = "Send supported logs and metrics from critical resources to the Bevoac Log Analytics workspace."
  type        = bool
  default     = true
}

variable "enable_baseline_activity_alerts" {
  description = "Enable baseline Azure Activity Log alerts for critical administrative changes."
  type        = bool
  default     = true
}
