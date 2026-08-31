output "resource_group_name" {
  value = azurerm_resource_group.rg.name
}

output "api_container_app_name" {
  value = var.deploy_container_apps ? local.api_container_app_name : null
}

output "worker_container_app_name" {
  value = var.deploy_container_apps ? local.worker_container_app_name : null
}

output "acr_login_server" {
  value = azurerm_container_registry.acr.login_server
}

output "api_fqdn" {
  value = var.deploy_container_apps ? local.api_fqdn_from_aca_environment : null
}

output "service_bus_namespace" {
  description = "Service Bus fully qualified namespace. Use service_bus_namespace_short with Azure CLI --namespace-name."
  value       = "${azurerm_servicebus_namespace.sb.name}.servicebus.windows.net"
}

output "service_bus_namespace_short" {
  description = "Short Service Bus namespace name for Azure CLI commands."
  value       = azurerm_servicebus_namespace.sb.name
}

output "service_bus_queue_name" {
  description = "Scan jobs queue name."
  value       = azurerm_servicebus_queue.scan_jobs.name
}

output "key_vault_name" {
  value = azurerm_key_vault.kv.name
}

output "postgres_fqdn" {
  value = azurerm_postgresql_flexible_server.postgres.fqdn
}

output "frontend_url" {
  value = var.deploy_onboarding_frontend ? azurerm_storage_account.frontend[0].primary_web_endpoint : null
}

output "api_public_base_url_effective" {
  description = "Effective public API base URL without path. Use this value in the onboarding frontend API field."
  value       = var.deploy_container_apps ? local.api_public_base_url_effective : null
}

output "onboarding_callback_uri_from_generated_aca_fqdn" {
  description = "Generated Azure Container Apps API base URL without callback path. This intentionally has no /v1/onboarding/azure/callback suffix."
  value       = var.deploy_container_apps ? local.api_public_base_url_from_generated_aca_fqdn : null
}

output "onboarding_redirect_uri" {
  description = "Effective onboarding API base URL without callback path. This intentionally matches onboarding_callback_uri_from_generated_aca_fqdn when api_public_base_url is empty."
  value       = var.deploy_container_apps ? local.api_public_base_url_effective : null
}

output "onboarding_redirect_callback_uri" {
  description = "Full Microsoft Entra redirect URI to register in the App Registration. This is the API base URL plus /v1/onboarding/azure/callback."
  value       = var.deploy_container_apps ? local.onboarding_redirect_callback_uri_effective : null
}

output "container_apps_egress_public_ip" {
  value = azurerm_public_ip.aca_nat.ip_address
}

output "db_admin_public_ip" {
  value = var.db_admin_public_ip
}

output "onboarding_success_url" {
  description = "External success URL injected into the API. Empty in api mode so the runtime uses /v1/onboarding/azure/result."
  value       = local.onboarding_success_url
}

output "onboarding_result_mode" {
  description = "Effective onboarding result mode after compatibility fallback resolution."
  value       = local.onboarding_result_mode_effective
}

output "onboarding_result_target" {
  description = "Effective callback result target: the API result path or the retained static success URL."
  value       = local.onboarding_result_target
}

output "retention_job_name" {
  description = "Scheduled retention Container Apps Job name."
  value       = var.deploy_container_apps && var.enable_retention_scheduler ? azurerm_container_app_job.retention[0].name : null
}

output "apim_gateway_url" {
  description = "Azure API Management public gateway URL when APIM is enabled."
  value       = var.enable_apim_gateway ? azurerm_api_management.gateway[0].gateway_url : null
}

output "apim_subscription_required" {
  description = "Whether APIM requires Ocp-Apim-Subscription-Key in addition to Bevoac API key."
  value       = var.enable_apim_gateway ? var.apim_subscription_required : null
}

output "monitor_action_group_id" {
  description = "Azure Monitor action group ID used by metric alerts."
  value       = var.monitor_action_group_id
}
