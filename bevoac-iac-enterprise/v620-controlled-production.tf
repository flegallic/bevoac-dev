# V6.2.0 controlled-production profile.
#
# This profile intentionally keeps selected PaaS endpoints publicly addressable
# until the V7 Enterprise Network Pack is enabled. It compensates with
# explicit firewall rules, Managed Identity, APIM backend authentication,
# monitoring, restore evidence and least-privilege runtime roles.

locals {
  controlled_production_profile = var.release_security_profile == "controlled_production"

  key_vault_ip_rules_effective = toset(distinct(compact(concat(
    tolist(var.key_vault_ip_rules),
    var.key_vault_allow_container_apps_egress
      ? [azurerm_public_ip.aca_nat.ip_address]
      : []
  ))))
}

resource "terraform_data" "v620_controlled_production_preconditions" {
  input = {
    profile                              = var.release_security_profile
    environment                          = var.environment
    apim_enabled                         = var.enable_apim_gateway
    apim_subscription_required           = var.apim_subscription_required
    apim_backend_boundary                = var.enable_apim_backend_boundary
    service_bus_local_auth_enabled       = var.service_bus_local_auth_enabled
    legacy_servicebus_secret             = var.retain_legacy_servicebus_connection_secret
    legacy_containerapp_rollback         = var.retain_legacy_containerapp_rollback_compatibility
    legacy_broad_key_vault_roles         = var.retain_legacy_broad_key_vault_roles
    legacy_api_servicebus_sender         = var.retain_legacy_api_servicebus_sender
    legacy_api_admin_secret_reader       = var.retain_legacy_api_admin_secret_reader
    key_vault_public_network             = var.key_vault_public_network_access_enabled
    key_vault_default_action             = var.key_vault_network_default_action
    key_vault_bypass                     = var.key_vault_network_bypass
    key_vault_effective_ip_rule_count    = length(local.key_vault_ip_rules_effective)
    monitoring_diagnostics               = var.enable_monitoring_diagnostics
    activity_alerts                      = var.enable_baseline_activity_alerts
    monitoring_required                  = var.require_production_monitoring
    dedicated_admin_api                  = var.enable_dedicated_admin_api
    legacy_static_onboarding_frontend      = var.deploy_onboarding_frontend
  }

  lifecycle {
    precondition {
      condition = !local.controlled_production_profile || lower(var.environment) == "prod"
      error_message = "release_security_profile=controlled_production is reserved for the production environment."
    }

    precondition {
      condition = !local.controlled_production_profile || (
        var.enable_apim_gateway &&
        var.apim_subscription_required &&
        var.enable_apim_backend_boundary
      )
      error_message = "V6.2 controlled production requires APIM subscriptions and the authenticated APIM backend boundary."
    }

    precondition {
      condition = !local.controlled_production_profile || (
        !var.service_bus_local_auth_enabled &&
        !var.retain_legacy_servicebus_connection_secret &&
        !var.retain_legacy_api_servicebus_sender
      )
      error_message = "V6.2 controlled production requires Managed Identity only for Service Bus and removal of legacy SAS compatibility."
    }

    precondition {
      condition = !local.controlled_production_profile || (
        !var.retain_legacy_containerapp_rollback_compatibility &&
        !var.retain_legacy_broad_key_vault_roles &&
        !var.retain_legacy_api_admin_secret_reader
      )
      error_message = "V6.2 controlled production requires retirement of legacy Container Apps revisions and broad Key Vault roles."
    }

    precondition {
      condition = !local.controlled_production_profile || (
        var.key_vault_public_network_access_enabled &&
        var.key_vault_network_default_action == "Deny" &&
        var.key_vault_network_bypass == "None" &&
        length(local.key_vault_ip_rules_effective) > 0
      )
      error_message = "V6.2 controlled production keeps Key Vault public only behind default Deny, no AzureServices bypass and explicit IP rules."
    }

    precondition {
      condition = !local.controlled_production_profile || (
        var.require_production_monitoring &&
        var.enable_monitoring_diagnostics &&
        var.enable_baseline_activity_alerts &&
        (
          trimspace(var.monitor_action_group_id) != "" ||
          trimspace(var.monitor_notification_email) != ""
        )
      )
      error_message = "V6.2 controlled production requires diagnostics, activity alerts and an operational Action Group."
    }


    precondition {
      condition     = !local.controlled_production_profile || !var.deploy_onboarding_frontend
      error_message = "V6.2 controlled production forbids the legacy static onboarding frontend. Use the API onboarding workflow and credential-free API result page."
    }

    precondition {
      condition = !local.controlled_production_profile || (
        var.enable_dedicated_admin_api &&
        trimspace(var.admin_oidc_issuer) != "" &&
        trimspace(var.admin_oidc_audience) != "" &&
        trimspace(var.admin_oidc_tenant_id) != ""
      )
      error_message = "V6.2 controlled production requires the isolated admin API with issuer, audience and tenant-bound OIDC configuration."
    }
  }
}
