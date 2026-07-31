# Dedicated workload identities, PostgreSQL secrets and secret-scoped RBAC.
# V6.1.3 wires every runtime to these resources and removes broad workload vault access.

resource "azurerm_user_assigned_identity" "outbox" {
  name                = "id-${local.name_suffix}-outbox"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  tags                = local.common_tags
}

resource "azurerm_user_assigned_identity" "retention" {
  name                = "id-${local.name_suffix}-retention"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  tags                = local.common_tags
}

resource "azurerm_user_assigned_identity" "admin_api" {
  name                = "id-${local.name_suffix}-admin-api"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  tags                = local.common_tags
}

resource "random_password" "pg_api_password" {
  length  = 40
  special = false
}

resource "random_password" "pg_worker_password" {
  length  = 40
  special = false
}

resource "random_password" "pg_outbox_password" {
  length  = 40
  special = false
}

resource "random_password" "pg_retention_password" {
  length  = 40
  special = false
}

resource "random_password" "pg_admin_api_password" {
  length  = 40
  special = false
}

resource "random_password" "pg_operator_password" {
  length  = 40
  special = false
}

resource "azurerm_key_vault_secret" "pg_api_password" {
  name         = "pg-api-password"
  value        = random_password.pg_api_password.result
  key_vault_id = azurerm_key_vault.kv.id
  depends_on   = [time_sleep.wait_for_kv_rbac]
}

resource "azurerm_key_vault_secret" "pg_worker_password" {
  name         = "pg-worker-password"
  value        = random_password.pg_worker_password.result
  key_vault_id = azurerm_key_vault.kv.id
  depends_on   = [time_sleep.wait_for_kv_rbac]
}

resource "azurerm_key_vault_secret" "pg_outbox_password" {
  name         = "pg-outbox-password"
  value        = random_password.pg_outbox_password.result
  key_vault_id = azurerm_key_vault.kv.id
  depends_on   = [time_sleep.wait_for_kv_rbac]
}

resource "azurerm_key_vault_secret" "pg_retention_password" {
  name         = "pg-retention-password"
  value        = random_password.pg_retention_password.result
  key_vault_id = azurerm_key_vault.kv.id
  depends_on   = [time_sleep.wait_for_kv_rbac]
}

resource "azurerm_key_vault_secret" "pg_admin_api_password" {
  name         = "pg-admin-api-password"
  value        = random_password.pg_admin_api_password.result
  key_vault_id = azurerm_key_vault.kv.id
  depends_on   = [time_sleep.wait_for_kv_rbac]
}

resource "azurerm_key_vault_secret" "pg_operator_password" {
  name         = "pg-operator-password"
  value        = random_password.pg_operator_password.result
  key_vault_id = azurerm_key_vault.kv.id
  depends_on   = [time_sleep.wait_for_kv_rbac]
}

# API: retain access to its currently referenced secrets, but at secret scope.
resource "azurerm_role_assignment" "api_pg_secret_reader" {
  scope                            = azurerm_key_vault_secret.pg_api_password.resource_versionless_id
  role_definition_name             = "Key Vault Secrets User"
  principal_id                     = azurerm_user_assigned_identity.api.principal_id
  principal_type                   = "ServicePrincipal"
  skip_service_principal_aad_check = true
}

resource "azurerm_role_assignment" "api_microsoft_secret_reader" {
  scope                            = azurerm_key_vault_secret.microsoft_client_secret.resource_versionless_id
  role_definition_name             = "Key Vault Secrets User"
  principal_id                     = azurerm_user_assigned_identity.api.principal_id
  principal_type                   = "ServicePrincipal"
  skip_service_principal_aad_check = true
}

resource "azurerm_role_assignment" "api_onboarding_secret_reader" {
  scope                            = azurerm_key_vault_secret.onboarding_state_secret.resource_versionless_id
  role_definition_name             = "Key Vault Secrets User"
  principal_id                     = azurerm_user_assigned_identity.api.principal_id
  principal_type                   = "ServicePrincipal"
  skip_service_principal_aad_check = true
}

# Rollback compatibility for legacy API revisions. Removed only during security finalization.
resource "azurerm_role_assignment" "api_legacy_admin_secret_reader" {
  count                            = var.retain_legacy_api_admin_secret_reader ? 1 : 0
  scope                            = azurerm_key_vault_secret.admin_api_secret.resource_versionless_id
  role_definition_name             = "Key Vault Secrets User"
  principal_id                     = azurerm_user_assigned_identity.api.principal_id
  principal_type                   = "ServicePrincipal"
  skip_service_principal_aad_check = true
}

# Worker: runtime password and Microsoft credential. Service Bus uses managed identity; no SAS/KEDA secret.
resource "azurerm_role_assignment" "worker_pg_secret_reader" {
  scope                            = azurerm_key_vault_secret.pg_worker_password.resource_versionless_id
  role_definition_name             = "Key Vault Secrets User"
  principal_id                     = azurerm_user_assigned_identity.worker.principal_id
  principal_type                   = "ServicePrincipal"
  skip_service_principal_aad_check = true
}

resource "azurerm_role_assignment" "worker_microsoft_secret_reader" {
  scope                            = azurerm_key_vault_secret.microsoft_client_secret.resource_versionless_id
  role_definition_name             = "Key Vault Secrets User"
  principal_id                     = azurerm_user_assigned_identity.worker.principal_id
  principal_type                   = "ServicePrincipal"
  skip_service_principal_aad_check = true
}

# Rollback compatibility for legacy worker revisions. Removed with the legacy Service Bus secret.
resource "azurerm_role_assignment" "worker_servicebus_secret_reader" {
  count                            = var.retain_legacy_servicebus_connection_secret ? 1 : 0
  scope                            = azurerm_key_vault_secret.servicebus_connection_string[0].resource_versionless_id
  role_definition_name             = "Key Vault Secrets User"
  principal_id                     = azurerm_user_assigned_identity.worker.principal_id
  principal_type                   = "ServicePrincipal"
  skip_service_principal_aad_check = true
}

# Dedicated outbox identity.
resource "azurerm_role_assignment" "outbox_pg_secret_reader" {
  scope                            = azurerm_key_vault_secret.pg_outbox_password.resource_versionless_id
  role_definition_name             = "Key Vault Secrets User"
  principal_id                     = azurerm_user_assigned_identity.outbox.principal_id
  principal_type                   = "ServicePrincipal"
  skip_service_principal_aad_check = true
}

resource "azurerm_role_assignment" "outbox_acr_pull" {
  scope                            = azurerm_container_registry.acr.id
  role_definition_name             = "AcrPull"
  principal_id                     = azurerm_user_assigned_identity.outbox.principal_id
  principal_type                   = "ServicePrincipal"
  skip_service_principal_aad_check = true
}

resource "azurerm_role_assignment" "outbox_sb_sender" {
  scope                            = azurerm_servicebus_namespace.sb.id
  role_definition_name             = "Azure Service Bus Data Sender"
  principal_id                     = azurerm_user_assigned_identity.outbox.principal_id
  principal_type                   = "ServicePrincipal"
  skip_service_principal_aad_check = true
}

# Dedicated retention identity.
resource "azurerm_role_assignment" "retention_pg_secret_reader" {
  scope                            = azurerm_key_vault_secret.pg_retention_password.resource_versionless_id
  role_definition_name             = "Key Vault Secrets User"
  principal_id                     = azurerm_user_assigned_identity.retention.principal_id
  principal_type                   = "ServicePrincipal"
  skip_service_principal_aad_check = true
}

resource "azurerm_role_assignment" "retention_acr_pull" {
  scope                            = azurerm_container_registry.acr.id
  role_definition_name             = "AcrPull"
  principal_id                     = azurerm_user_assigned_identity.retention.principal_id
  principal_type                   = "ServicePrincipal"
  skip_service_principal_aad_check = true
}

# Reserved identity for the future isolated administration API.
resource "azurerm_role_assignment" "admin_api_pg_secret_reader" {
  scope                            = azurerm_key_vault_secret.pg_admin_api_password.resource_versionless_id
  role_definition_name             = "Key Vault Secrets User"
  principal_id                     = azurerm_user_assigned_identity.admin_api.principal_id
  principal_type                   = "ServicePrincipal"
  skip_service_principal_aad_check = true
}

resource "azurerm_role_assignment" "admin_api_acr_pull" {
  scope                            = azurerm_container_registry.acr.id
  role_definition_name             = "AcrPull"
  principal_id                     = azurerm_user_assigned_identity.admin_api.principal_id
  principal_type                   = "ServicePrincipal"
  skip_service_principal_aad_check = true
}

resource "time_sleep" "wait_for_dedicated_workload_roles" {
  create_duration = "45s"

  depends_on = [
    azurerm_role_assignment.api_pg_secret_reader,
    azurerm_role_assignment.api_microsoft_secret_reader,
    azurerm_role_assignment.api_onboarding_secret_reader,
    azurerm_role_assignment.api_legacy_admin_secret_reader,
    azurerm_role_assignment.worker_pg_secret_reader,
    azurerm_role_assignment.worker_microsoft_secret_reader,
    azurerm_role_assignment.worker_servicebus_secret_reader,
    azurerm_role_assignment.outbox_pg_secret_reader,
    azurerm_role_assignment.outbox_acr_pull,
    azurerm_role_assignment.outbox_sb_sender,
    azurerm_role_assignment.retention_pg_secret_reader,
    azurerm_role_assignment.retention_acr_pull,
    azurerm_role_assignment.admin_api_pg_secret_reader,
    azurerm_role_assignment.admin_api_acr_pull
  ]
}
