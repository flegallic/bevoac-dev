locals {
  onboarding_custom_domain_normalized            = lower(trimspace(var.onboarding_custom_domain))
  onboarding_managed_certificate_name_normalized = trimspace(var.onboarding_managed_certificate_name)
}

# DNS ownership is intentionally external to this Terraform stack.
# The authoritative CNAME and asuid TXT records must exist before this
# resource is created or adopted.
resource "azurerm_container_app_custom_domain" "onboarding" {
  count = var.deploy_container_apps && local.onboarding_custom_domain_normalized != "" ? 1 : 0

  name             = local.onboarding_custom_domain_normalized
  container_app_id = azurerm_container_app.api[0].id

  lifecycle {
    # Azure updates these values asynchronously when an Azure managed
    # certificate is attached. Ignoring them prevents false replacement.
    ignore_changes = [
      certificate_binding_type,
      container_app_environment_certificate_id,
    ]
  }
}

resource "azurerm_container_app_environment_managed_certificate" "onboarding" {
  count = (
    var.deploy_container_apps &&
    local.onboarding_custom_domain_normalized != "" &&
    local.onboarding_managed_certificate_name_normalized != ""
  ) ? 1 : 0

  name                         = local.onboarding_managed_certificate_name_normalized
  container_app_environment_id = azurerm_container_app_environment.env[0].id
  subject_name                 = local.onboarding_custom_domain_normalized
  domain_control_validation    = "CNAME"

  depends_on = [azurerm_container_app_custom_domain.onboarding]
}
