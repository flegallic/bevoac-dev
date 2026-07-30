output "admin_api_container_app_name" {
  description = "Dedicated administration API Container App name."
  value       = var.deploy_container_apps && var.enable_dedicated_admin_api ? azurerm_container_app.admin_api[0].name : null
}

output "enterprise_runtime_database_roles" {
  description = "PostgreSQL login expected for each V6.1.3 runtime."
  value = {
    public_api = "bevoac_api"
    worker     = "bevoac_worker"
    outbox     = "bevoac_outbox"
    retention  = "bevoac_retention"
    admin_api  = "bevoac_admin_api"
    operator   = "bevoac_operator"
  }
}

output "service_bus_identity_only_auth" {
  description = "V6.1.3 disables Service Bus SAS/local authentication."
  value       = true
}

output "pg_admin_username" {
  description = "PostgreSQL administrator login used only for migrations and structural verification."
  value       = var.pg_admin_username
}
