# V6.2.0 controlled-production boundary between APIM and the public
# Container Apps backend. This compensating control prevents clients that
# possess a Bevoac API key from bypassing APIM quotas and subscription checks.

# SECURITY NOTE: random_password values are known to Terraform and are stored
# in Terraform state even when the downstream APIM named value is marked secret.
# The production state backend must therefore be encrypted, access-controlled,
# audited, excluded from source/evidence archives, and treated as secret material.

resource "random_password" "apim_backend_token" {
  count   = var.enable_apim_gateway && var.enable_apim_backend_boundary ? 1 : 0
  length  = 64
  special = false
}

resource "azurerm_key_vault_secret" "apim_backend_token" {
  count        = var.enable_apim_gateway && var.enable_apim_backend_boundary ? 1 : 0
  name         = "apim-backend-token"
  value        = random_password.apim_backend_token[0].result
  key_vault_id = azurerm_key_vault.kv.id
  tags         = merge(local.common_tags, { Purpose = "APIM backend boundary" })
  depends_on   = [time_sleep.wait_for_kv_rbac]
}

resource "azurerm_role_assignment" "api_apim_backend_secret_reader" {
  count                            = var.enable_apim_gateway && var.enable_apim_backend_boundary ? 1 : 0
  scope                            = azurerm_key_vault_secret.apim_backend_token[0].resource_versionless_id
  role_definition_name             = "Key Vault Secrets User"
  principal_id                     = azurerm_user_assigned_identity.api.principal_id
  principal_type                   = "ServicePrincipal"
  skip_service_principal_aad_check = true
}

resource "azurerm_api_management_named_value" "bevoac_backend_token" {
  count               = var.enable_apim_gateway && var.enable_apim_backend_boundary ? 1 : 0
  name                = "bevoac-backend-token"
  display_name        = "bevoac-backend-token"
  resource_group_name = azurerm_resource_group.rg.name
  api_management_name = azurerm_api_management.gateway[0].name
  secret              = true
  tags                = ["bevoac", "backend-boundary"]

  # APIM stores the same generated value as a secret named value. The API
  # reads its copy from Key Vault. This avoids granting APIM data-plane access
  # to Key Vault while the vault is protected by a public default-deny ACL.
  value = random_password.apim_backend_token[0].result
}

locals {
  apim_backend_boundary_policy = var.enable_apim_backend_boundary ? join("\n", [
    "    <set-header name=\"X-Bevoac-Backend-Token\" exists-action=\"override\">",
    "      <value>{{bevoac-backend-token}}</value>",
    "    </set-header>",
  ]) : ""
}
