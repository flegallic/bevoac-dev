resource "azurerm_subnet" "private_endpoints" {
  count                = var.enable_private_endpoints ? 1 : 0
  name                 = "snet-private-endpoints"
  resource_group_name  = azurerm_resource_group.rg.name
  virtual_network_name = azurerm_virtual_network.vnet.name
  address_prefixes     = ["10.30.10.0/24"]
}

resource "azurerm_private_dns_zone" "kv" {
  count               = var.enable_private_endpoints ? 1 : 0
  name                = "privatelink.vaultcore.azure.net"
  resource_group_name = azurerm_resource_group.rg.name
  tags                = local.common_tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "kv" {
  count                 = var.enable_private_endpoints ? 1 : 0
  name                  = "pdns-kv-${local.name_suffix}"
  resource_group_name   = azurerm_resource_group.rg.name
  private_dns_zone_name = azurerm_private_dns_zone.kv[0].name
  virtual_network_id    = azurerm_virtual_network.vnet.id
  registration_enabled  = false
  tags                  = local.common_tags
}

resource "azurerm_private_endpoint" "kv" {
  count               = var.enable_private_endpoints ? 1 : 0
  name                = "pe-${local.name_suffix}-kv"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  subnet_id           = azurerm_subnet.private_endpoints[0].id
  tags                = local.common_tags

  private_service_connection {
    name                           = "psc-${local.name_suffix}-kv"
    private_connection_resource_id = azurerm_key_vault.kv.id
    is_manual_connection           = false
    subresource_names              = ["vault"]
  }

  private_dns_zone_group {
    name                 = "default"
    private_dns_zone_ids = [azurerm_private_dns_zone.kv[0].id]
  }
}

resource "azurerm_private_dns_zone" "postgres" {
  count               = var.enable_private_endpoints ? 1 : 0
  name                = "privatelink.postgres.database.azure.com"
  resource_group_name = azurerm_resource_group.rg.name
  tags                = local.common_tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "postgres" {
  count                 = var.enable_private_endpoints ? 1 : 0
  name                  = "pdns-psql-${local.name_suffix}"
  resource_group_name   = azurerm_resource_group.rg.name
  private_dns_zone_name = azurerm_private_dns_zone.postgres[0].name
  virtual_network_id    = azurerm_virtual_network.vnet.id
  registration_enabled  = false
  tags                  = local.common_tags
}

resource "azurerm_private_endpoint" "postgres" {
  count               = var.enable_private_endpoints ? 1 : 0
  name                = "pe-${local.name_suffix}-psql"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  subnet_id           = azurerm_subnet.private_endpoints[0].id
  tags                = local.common_tags

  private_service_connection {
    name                           = "psc-${local.name_suffix}-psql"
    private_connection_resource_id = azurerm_postgresql_flexible_server.postgres.id
    is_manual_connection           = false
    subresource_names              = ["postgresqlServer"]
  }

  private_dns_zone_group {
    name                 = "default"
    private_dns_zone_ids = [azurerm_private_dns_zone.postgres[0].id]
  }
}
