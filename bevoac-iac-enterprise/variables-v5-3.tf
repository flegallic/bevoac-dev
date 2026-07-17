variable "enable_dedicated_outbox_publisher" {
  description = "Deploy a dedicated Container App for transactional outbox publishing. When true, the API background publisher is disabled through runtime env vars."
  type        = bool
  default     = true
}

variable "outbox_publisher_min_replicas" {
  description = "Minimum replicas for the dedicated outbox publisher. Use 1 for production-oriented environments."
  type        = number
  default     = 1
}

variable "outbox_publisher_max_replicas" {
  description = "Maximum replicas for the dedicated outbox publisher. Keep 1 unless publisher concurrency is explicitly reviewed."
  type        = number
  default     = 1
}

variable "outbox_publish_interval_ms" {
  description = "Dedicated outbox publisher polling interval in milliseconds."
  type        = number
  default     = 5000
}

variable "outbox_publish_batch_size" {
  description = "Dedicated outbox publisher batch size."
  type        = number
  default     = 25
}

variable "outbox_max_attempts" {
  description = "Maximum outbox publish attempts before manual investigation."
  type        = number
  default     = 10
}

variable "outbox_base_backoff_seconds" {
  description = "Base exponential backoff for outbox publish retries."
  type        = number
  default     = 15
}
