resource "azurerm_storage_account" "frontend" {
  count                           = var.deploy_onboarding_frontend ? 1 : 0
  name                            = substr(replace("st${local.name_suffix}front", "-", ""), 0, 24)
  resource_group_name             = azurerm_resource_group.rg.name
  location                        = azurerm_resource_group.rg.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  account_kind                    = "StorageV2"
  min_tls_version                 = "TLS1_2"
  https_traffic_only_enabled      = true
  public_network_access_enabled   = true
  allow_nested_items_to_be_public = false
  tags                            = local.common_tags
}

resource "azurerm_storage_account_static_website" "frontend" {
  count              = var.deploy_onboarding_frontend ? 1 : 0
  storage_account_id = azurerm_storage_account.frontend[0].id
  index_document     = "index.html"
  error_404_document = "index.html"
}

resource "azurerm_storage_blob" "frontend_index" {
  count                  = var.deploy_onboarding_frontend ? 1 : 0
  name                   = "index.html"
  storage_account_name   = azurerm_storage_account.frontend[0].name
  storage_container_name = "$web"
  type                   = "Block"
  content_type           = "text/html"
  source_content = templatefile("${path.module}/frontend/index.html.tftpl", {
    brand_name    = var.frontend_brand_name
    support_email = var.frontend_support_email
    api_base_url  = var.deploy_container_apps ? local.api_public_base_url_effective : ""
  })

  depends_on = [azurerm_storage_account_static_website.frontend]

  lifecycle {
    ignore_changes = [source_content]
  }
}

resource "azurerm_storage_blob" "frontend_success" {
  count                  = var.deploy_onboarding_frontend ? 1 : 0
  name                   = "success.html"
  storage_account_name   = azurerm_storage_account.frontend[0].name
  storage_container_name = "$web"
  type                   = "Block"
  content_type           = "text/html"
  source_content = templatefile("${path.module}/frontend/success.html.tftpl", {
    brand_name    = var.frontend_brand_name
    support_email = var.frontend_support_email
  })

  depends_on = [azurerm_storage_account_static_website.frontend]
}
