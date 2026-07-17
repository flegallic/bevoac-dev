resource "azurerm_api_management" "gateway" {
  count               = 1
  name                = substr(replace("apim-${local.name_suffix}", "_", "-"), 0, 50)
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  publisher_name      = var.apim_publisher_name
  publisher_email     = var.apim_publisher_email
  sku_name            = var.apim_sku_name
  tags                = local.common_tags
}

resource "azurerm_api_management_api" "bevoac" {
  count                 = 1
  name                  = "bevoac-api"
  resource_group_name   = azurerm_resource_group.rg.name
  api_management_name   = azurerm_api_management.gateway[0].name
  revision              = "1"
  display_name          = "Bevoac API"
  path                  = "v1"
  protocols             = ["https"]
  service_url           = "${local.api_public_base_url_effective}/v1"
  subscription_required = true
}

resource "azurerm_api_management_api_policy" "bevoac" {
  count               = var.enable_apim_gateway ? 1 : 0
  api_name            = azurerm_api_management_api.bevoac[0].name
  api_management_name = azurerm_api_management.gateway[0].name
  resource_group_name = azurerm_resource_group.rg.name

  xml_content = <<XML
<policies>
  <inbound>
    <base />
    <set-header name="X-Forwarded-Proto" exists-action="override">
      <value>https</value>
    </set-header>
    <set-header name="X-Correlation-Id" exists-action="skip">
      <value>@(context.RequestId.ToString())</value>
    </set-header>
    <set-header name="X-Bevoac-Gateway" exists-action="override">
      <value>apim</value>
    </set-header>
    <rate-limit calls="60" renewal-period="60" />
    <validate-content unspecified-content-type-action="ignore" max-size="1048576" size-exceeded-action="prevent" errors-variable-name="bevoacRequestBodyValidation" />
  </inbound>
  <backend>
    <base />
  </backend>
  <outbound>
    <base />
    <set-header name="X-Correlation-Id" exists-action="skip">
      <value>@(context.RequestId.ToString())</value>
    </set-header>
  </outbound>
  <on-error>
    <base />
  </on-error>
</policies>
XML
}



resource "azurerm_api_management_product" "bevoac" {
  count                 = var.enable_apim_gateway ? 1 : 0
  product_id            = "bevoac-product"
  api_management_name   = azurerm_api_management.gateway[0].name
  resource_group_name   = azurerm_resource_group.rg.name
  display_name          = "Bevoac API Product"
  description           = "Product-scoped subscription for Bevoac B2B clients. Required for APIM quota enforcement on Consumption SKU."
  subscription_required = true
  approval_required     = false
  published             = true
}

resource "azurerm_api_management_product_api" "bevoac" {
  count               = var.enable_apim_gateway ? 1 : 0
  api_name            = azurerm_api_management_api.bevoac[0].name
  product_id          = azurerm_api_management_product.bevoac[0].product_id
  api_management_name = azurerm_api_management.gateway[0].name
  resource_group_name = azurerm_resource_group.rg.name
}

resource "azurerm_api_management_product_policy" "bevoac" {
  count               = var.enable_apim_gateway ? 1 : 0
  product_id          = azurerm_api_management_product.bevoac[0].product_id
  api_management_name = azurerm_api_management.gateway[0].name
  resource_group_name = azurerm_resource_group.rg.name

  xml_content = <<XML
<policies>
  <inbound>
    <base />
    <quota calls="5000" renewal-period="86400" />
  </inbound>
  <backend>
    <base />
  </backend>
  <outbound>
    <base />
  </outbound>
  <on-error>
    <base />
  </on-error>
</policies>
XML
}

locals {
  apim_proxy_methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]
}

resource "azurerm_api_management_api_operation" "bevoac_proxy" {
  count               = length(local.apim_proxy_methods)
  operation_id        = "proxy-${lower(local.apim_proxy_methods[count.index])}"
  api_name            = azurerm_api_management_api.bevoac[0].name
  api_management_name = azurerm_api_management.gateway[0].name
  resource_group_name = azurerm_resource_group.rg.name

  display_name = "Proxy ${local.apim_proxy_methods[count.index]}"
  method       = local.apim_proxy_methods[count.index]
  url_template = "/*"

  response {
    status_code = 200
    description = "Proxied response from Bevoac API"
  }
}
