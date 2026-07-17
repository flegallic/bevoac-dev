output "outbox_publisher_container_app_name" {
  description = "Dedicated transactional outbox publisher Container App name when enabled."
  value       = var.deploy_container_apps && var.enable_dedicated_outbox_publisher ? azurerm_container_app.outbox_publisher[0].name : null
}
