resource "azurerm_virtual_network" "vnet" {
  name                = "vnet-${local.name_suffix}"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  address_space       = ["10.30.0.0/16"]
  tags                = local.common_tags
}

resource "azurerm_subnet" "aca" {
  name                 = "snet-aca"
  resource_group_name  = azurerm_resource_group.rg.name
  virtual_network_name = azurerm_virtual_network.vnet.name
  address_prefixes     = ["10.30.0.0/23"]

  delegation {
    name = "aca-delegation"
    service_delegation {
      name    = "Microsoft.App/environments"
      actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    }
  }
}

resource "azurerm_public_ip" "aca_nat" {
  name                = "pip-${local.name_suffix}-egress"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  allocation_method   = "Static"
  sku                 = "Standard"
  tags                = local.common_tags
}

resource "azurerm_nat_gateway" "aca" {
  name                    = "nat-${local.name_suffix}"
  location                = azurerm_resource_group.rg.location
  resource_group_name     = azurerm_resource_group.rg.name
  sku_name                = "Standard"
  idle_timeout_in_minutes = 10
  tags                    = local.common_tags
}

resource "azurerm_nat_gateway_public_ip_association" "aca" {
  nat_gateway_id       = azurerm_nat_gateway.aca.id
  public_ip_address_id = azurerm_public_ip.aca_nat.id
}

resource "azurerm_subnet_nat_gateway_association" "aca" {
  subnet_id      = azurerm_subnet.aca.id
  nat_gateway_id = azurerm_nat_gateway.aca.id
}
