locals {
  name_suffix = replace(lower(var.prefix), "_", "-")
  common_tags = merge(var.tags, {
    Environment = var.environment
  })

  api_container_app_name    = "ca-${local.name_suffix}-api"
  worker_container_app_name = "ca-${local.name_suffix}-worker"

  onboarding_result_mode_requested = lower(trimspace(var.onboarding_result_mode))

  frontend_origin = var.deploy_onboarding_frontend ? trimsuffix(try(azurerm_storage_account.frontend[0].primary_web_endpoint, ""), "/") : ""

  # Operator-provided public API base URL.
  # Use only for a stable custom domain, for example https://api-poc.bevoac.fr.
  # Leave var.api_public_base_url empty when using the generated Azure Container Apps FQDN.
  api_public_base_url_configured = trimsuffix(trimspace(var.api_public_base_url), "/")

  # Azure Container Apps generated FQDN computed from the app name and the environment default domain.
  # This avoids referencing azurerm_container_app.api[0].ingress[0].fqdn inside the same Container App resource.
  api_fqdn_from_aca_environment = (
    var.deploy_container_apps
    ? "${local.api_container_app_name}.${azurerm_container_app_environment.env[0].default_domain}"
    : ""
  )

  api_public_base_url_from_generated_aca_fqdn = (
    local.api_fqdn_from_aca_environment != ""
    ? "https://${local.api_fqdn_from_aca_environment}"
    : ""
  )

  # Effective public API base URL used by operators and APIM-facing runtime configuration.
  # If api_public_base_url is empty, it is generated automatically from Azure Container Apps.
  api_public_base_url_effective = (
    local.api_public_base_url_configured != ""
    ? local.api_public_base_url_configured
    : local.api_public_base_url_from_generated_aca_fqdn
  )

  # Optional dedicated public origin for the production onboarding flow.
  # Keep this independent from api_public_base_url_effective so APIM continues
  # to target the technical ACA API origin.
  onboarding_public_base_url_configured = trimsuffix(trimspace(var.onboarding_public_base_url), "/")
  onboarding_public_base_url_effective = (
    local.onboarding_public_base_url_configured != ""
    ? local.onboarding_public_base_url_configured
    : local.api_public_base_url_effective
  )

  onboarding_landing_url = (
    local.onboarding_public_base_url_effective != ""
    ? "${local.onboarding_public_base_url_effective}/v1/onboarding/azure"
    : ""
  )

  # The canonical API-hosted landing page is same-origin with its browser bootstrap
  # endpoint. The legacy Storage static website no longer needs CORS access.
  allowed_origins_effective = distinct(compact(concat(
    var.allowed_origins,
    local.onboarding_public_base_url_effective != "" ? [local.onboarding_public_base_url_effective] : []
  )))
  allowed_origins_csv = join(",", local.allowed_origins_effective)

  # Legacy static success URL retained only for rollback compatibility.
  onboarding_base_url              = var.frontend_custom_domain != "" ? "https://${var.frontend_custom_domain}" : local.frontend_origin
  onboarding_legacy_success_url    = local.onboarding_base_url != "" ? "${local.onboarding_base_url}/success.html" : ""
  onboarding_result_mode_effective = local.onboarding_result_mode_requested == "legacy_static" && local.onboarding_legacy_success_url == "" ? "api" : local.onboarding_result_mode_requested
  onboarding_success_url           = local.onboarding_result_mode_effective == "legacy_static" ? local.onboarding_legacy_success_url : ""
  onboarding_result_target         = local.onboarding_result_mode_effective == "api" ? "/v1/onboarding/azure/result" : local.onboarding_legacy_success_url

  # Full Microsoft Entra redirect URI registered in the App Registration and injected into the API runtime.
  onboarding_redirect_callback_uri_effective = (
    local.onboarding_public_base_url_effective != ""
    ? "${local.onboarding_public_base_url_effective}/v1/onboarding/azure/callback"
    : ""
  )
}
