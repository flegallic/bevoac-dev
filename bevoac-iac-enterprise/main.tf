data "azurerm_client_config" "current" {}

resource "azurerm_resource_group" "rg" {
  name     = "rg-${local.name_suffix}"
  location = var.location
  tags     = local.common_tags
}

resource "azurerm_log_analytics_workspace" "law" {
  name                = "law-${local.name_suffix}"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  sku                 = "PerGB2018"
  retention_in_days   = var.log_retention_days
  tags                = local.common_tags
}

resource "azurerm_container_registry" "acr" {
  name                = substr(replace("acr${local.name_suffix}", "-", ""), 0, 50)
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  sku                 = "Premium"
  admin_enabled       = false
  tags                = local.common_tags
}

resource "azurerm_key_vault" "kv" {
  name                          = substr(replace("kv-${local.name_suffix}", "-", ""), 0, 24)
  location                      = azurerm_resource_group.rg.location
  resource_group_name           = azurerm_resource_group.rg.name
  tenant_id                     = var.tenant_id
  sku_name                      = "standard"
  purge_protection_enabled      = true
  soft_delete_retention_days    = 90
  rbac_authorization_enabled    = true
  public_network_access_enabled = !var.enable_private_endpoints
  tags                          = local.common_tags
}

resource "azurerm_role_assignment" "current_kv_admin" {
  scope                = azurerm_key_vault.kv.id
  role_definition_name = "Key Vault Administrator"
  principal_id         = data.azurerm_client_config.current.object_id
}

resource "time_sleep" "wait_for_kv_rbac" {
  create_duration = "45s"
  depends_on      = [azurerm_role_assignment.current_kv_admin]
}

resource "azurerm_user_assigned_identity" "api" {
  name                = "id-${local.name_suffix}-api"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  tags                = local.common_tags
}

resource "azurerm_user_assigned_identity" "worker" {
  name                = "id-${local.name_suffix}-worker"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  tags                = local.common_tags
}

resource "random_password" "pg_password" {
  length  = 32
  special = false
}

resource "azurerm_key_vault_secret" "pg_password" {
  name         = "pg-password"
  value        = random_password.pg_password.result
  key_vault_id = azurerm_key_vault.kv.id
  depends_on   = [time_sleep.wait_for_kv_rbac]
}

resource "azurerm_key_vault_secret" "admin_api_secret" {
  name         = "admin-api-secret"
  value        = var.admin_api_secret
  key_vault_id = azurerm_key_vault.kv.id
  depends_on   = [time_sleep.wait_for_kv_rbac]
}

resource "azurerm_key_vault_secret" "microsoft_client_secret" {
  name         = "microsoft-client-secret"
  value        = var.microsoft_client_secret
  key_vault_id = azurerm_key_vault.kv.id
  depends_on   = [time_sleep.wait_for_kv_rbac]
}

resource "azurerm_role_assignment" "api_acr_pull" {
  scope                = azurerm_container_registry.acr.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_user_assigned_identity.api.principal_id
}

resource "azurerm_role_assignment" "worker_acr_pull" {
  scope                = azurerm_container_registry.acr.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_user_assigned_identity.worker.principal_id
}

resource "azurerm_role_assignment" "api_kv_reader" {
  scope                = azurerm_key_vault.kv.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.api.principal_id
}

resource "azurerm_role_assignment" "worker_kv_reader" {
  scope                = azurerm_key_vault.kv.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.worker.principal_id
}

resource "time_sleep" "wait_for_workload_roles" {
  create_duration = "45s"
  depends_on = [
    azurerm_role_assignment.api_acr_pull,
    azurerm_role_assignment.worker_acr_pull,
    azurerm_role_assignment.api_kv_reader,
    azurerm_role_assignment.worker_kv_reader,
    azurerm_role_assignment.api_sb_sender,
    azurerm_role_assignment.worker_sb_receiver
  ]
}

resource "random_password" "onboarding_state_secret" {
  length  = 64
  special = false
}

resource "azurerm_key_vault_secret" "onboarding_state_secret" {
  name         = "onboarding-state-secret"
  value        = var.onboarding_state_secret != "" ? var.onboarding_state_secret : random_password.onboarding_state_secret.result
  key_vault_id = azurerm_key_vault.kv.id
  depends_on   = [time_sleep.wait_for_kv_rbac]
}
