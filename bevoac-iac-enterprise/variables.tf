variable "location" {
  type        = string
  description = "Azure region"
  default     = "francecentral"
}

variable "environment" {
  type        = string
  description = "Environment name"
  default     = "dev"
}

variable "prefix" {
  type        = string
  description = "Resource naming prefix"
  default     = "bevoac-dev"
}

variable "tenant_id" {
  type        = string
  description = "Deployment tenant id"
}

variable "pg_admin_username" {
  type        = string
  description = "PostgreSQL administrator username"
  default     = "bevoacadmin"
}

variable "db_admin_public_ip" {
  type        = string
  description = "Optional public IPv4 address allowed to administer PostgreSQL from a controlled operator workstation. Leave empty by default."
  default     = ""
}

variable "enable_db_admin_public_ip_rule" {
  type        = bool
  description = "Create the optional PostgreSQL firewall rule for db_admin_public_ip. Keep false unless direct workstation administration is explicitly required."
  default     = false
}

variable "api_image" {
  type        = string
  description = "Full image reference for the API container"
}

variable "worker_image" {
  type        = string
  description = "Full image reference for the worker container"
}

variable "outbox_image" {
  type        = string
  description = "Full image reference for the dedicated outbox publisher container"
}

variable "retention_image" {
  type        = string
  description = "Full image reference for the retention job container"
}

variable "allowed_origins" {
  type        = list(string)
  description = "Additional allowed CORS origins for the API"
  default     = []
}

variable "deploy_container_apps" {
  type        = bool
  description = "Set to false for first bootstrap if images are not in ACR yet"
  default     = true
}

variable "deploy_onboarding_frontend" {
  type        = bool
  description = "Deploy the legacy static onboarding helper. It is demo-only and must remain false for the V6.2 controlled-production profile."
  default     = false
}

variable "frontend_brand_name" {
  type        = string
  description = "Brand name shown in the onboarding portal"
  default     = "Bevoac Security"
}

variable "frontend_support_email" {
  type        = string
  description = "Support email shown on the onboarding portal"
  default     = "support@bevoac.fr"
}

variable "frontend_custom_domain" {
  type        = string
  description = "Optional custom domain for the onboarding portal, without scheme"
  default     = ""
}

variable "admin_api_secret" {
  type        = string
  description = "Admin shared secret for back-office routes"
  sensitive   = true

  validation {
    condition     = length(trimspace(var.admin_api_secret)) >= 32
    error_message = "admin_api_secret must contain at least 32 characters."
  }
}

variable "microsoft_client_id" {
  type        = string
  description = "Client ID of the Bevoac multitenant app registration"

  validation {
    condition     = can(regex("^[0-9a-fA-F-]{36}$", var.microsoft_client_id))
    error_message = "microsoft_client_id must be a Microsoft Entra application UUID."
  }
}

variable "microsoft_client_secret" {
  type        = string
  description = "Client secret of the Bevoac multitenant app registration"
  sensitive   = true

  validation {
    condition     = length(trimspace(var.microsoft_client_secret)) >= 16
    error_message = "microsoft_client_secret must not be empty. Use a real client secret from Key Vault / Entra."
  }
}

variable "service_bus_queue_name" {
  type        = string
  description = "Scan queue name"
  default     = "scan-jobs"
}

variable "tags" {
  type = map(string)
  default = {
    Project     = "bevoac"
    ManagedBy   = "terraform"
    Environment = "dev"
    Security    = "enterprise"
  }
}

variable "api_public_base_url" {
  type        = string
  description = "Optional public base URL for the API, for example https://api.example.com. Required before Microsoft Entra app registration can use a stable admin-consent callback URI."
  default     = ""

  validation {
    condition     = var.api_public_base_url == "" || can(regex("^https://[^/]+", var.api_public_base_url))
    error_message = "api_public_base_url must be empty during bootstrap or an HTTPS origin such as https://api.example.com."
  }
}

variable "onboarding_state_secret" {
  type        = string
  description = "Optional high-entropy HMAC secret for Microsoft admin-consent state validation. Leave empty to let Terraform generate one."
  sensitive   = true
  default     = ""

  validation {
    condition     = var.onboarding_state_secret == "" || length(trimspace(var.onboarding_state_secret)) >= 32
    error_message = "onboarding_state_secret must be empty for Terraform generation or contain at least 32 characters."
  }
}

# V4 guardrails. These validations catch demo-breaking values before deployment.
# They intentionally allow api_public_base_url to be empty for the first bootstrap pass,
# but production onboarding requires it to be set before the client admin-consent demo.


variable "retention_done_days_free" {
  type        = number
  description = "Retention in days for DONE scan JSON/PDF evidence for free tenants."
  default     = 30
}

variable "retention_done_days_standard" {
  type        = number
  description = "Retention in days for DONE scan JSON/PDF evidence for standard tenants."
  default     = 90
}

variable "retention_done_days_business" {
  type        = number
  description = "Retention in days for DONE scan JSON/PDF evidence for business tenants."
  default     = 180
}

variable "retention_done_days_payg" {
  type        = number
  description = "Retention in days for DONE scan JSON/PDF evidence for payg tenants."
  default     = 180
}
