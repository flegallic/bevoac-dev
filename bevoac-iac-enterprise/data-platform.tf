resource "azurerm_postgresql_flexible_server" "postgres" {
  name                          = "psql-${local.name_suffix}"
  resource_group_name           = azurerm_resource_group.rg.name
  location                      = azurerm_resource_group.rg.location
  version                       = "16"
  administrator_login           = var.pg_admin_username
  administrator_password        = random_password.pg_password.result
  public_network_access_enabled = var.enable_postgres_public_access
  zone                          = "1"
  storage_mb                    = 65536
  sku_name                      = "GP_Standard_D2s_v3"
  backup_retention_days         = 14
  tags                          = local.common_tags
}

resource "azurerm_postgresql_flexible_server_firewall_rule" "admin_ip" {
  count            = var.enable_postgres_public_access && var.enable_db_admin_public_ip_rule && length(trimspace(var.db_admin_public_ip)) > 0 ? 1 : 0
  name             = "allow-bevoac-admin-ip"
  server_id        = azurerm_postgresql_flexible_server.postgres.id
  start_ip_address = var.db_admin_public_ip
  end_ip_address   = var.db_admin_public_ip
}

resource "azurerm_postgresql_flexible_server_firewall_rule" "container_apps_egress" {
  count            = var.enable_postgres_public_access ? 1 : 0
  name             = "allow-containerapps-egress"
  server_id        = azurerm_postgresql_flexible_server.postgres.id
  start_ip_address = azurerm_public_ip.aca_nat.ip_address
  end_ip_address   = azurerm_public_ip.aca_nat.ip_address
}

resource "azurerm_servicebus_namespace" "sb" {
  name                = "sb-${local.name_suffix}"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  sku                 = "Standard"
  tags                = local.common_tags
}

resource "azurerm_servicebus_queue" "scan_jobs" {
  name                                 = var.service_bus_queue_name
  namespace_id                         = azurerm_servicebus_namespace.sb.id
  max_delivery_count                   = 5
  lock_duration                        = "PT5M"
  requires_session                     = var.enable_service_bus_sessions
  dead_lettering_on_message_expiration = true
}

data "azurerm_servicebus_namespace_authorization_rule" "root" {
  name         = "RootManageSharedAccessKey"
  namespace_id = azurerm_servicebus_namespace.sb.id
}

resource "azurerm_key_vault_secret" "servicebus_connection_string" {
  name         = "servicebus-connection-string"
  value        = data.azurerm_servicebus_namespace_authorization_rule.root.primary_connection_string
  key_vault_id = azurerm_key_vault.kv.id
  depends_on   = [time_sleep.wait_for_kv_rbac]
}

resource "azurerm_role_assignment" "api_sb_sender" {
  scope                = azurerm_servicebus_namespace.sb.id
  role_definition_name = "Azure Service Bus Data Sender"
  principal_id         = azurerm_user_assigned_identity.api.principal_id
}

resource "azurerm_role_assignment" "worker_sb_receiver" {
  scope                = azurerm_servicebus_namespace.sb.id
  role_definition_name = "Azure Service Bus Data Receiver"
  principal_id         = azurerm_user_assigned_identity.worker.principal_id
}

resource "azurerm_postgresql_flexible_server_configuration" "azure_extensions" {
  name      = "azure.extensions"
  server_id = azurerm_postgresql_flexible_server.postgres.id
  value     = "pgcrypto"
}
