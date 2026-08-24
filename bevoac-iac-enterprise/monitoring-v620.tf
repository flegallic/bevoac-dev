locals {
  monitor_action_group_id_effective = (
    trimspace(var.monitor_action_group_id) != ""
    ? trimspace(var.monitor_action_group_id)
    : try(azurerm_monitor_action_group.operations[0].id, "")
  )

  diagnostic_targets_base = {
    postgresql = {
      name = "postgresql"
      id   = azurerm_postgresql_flexible_server.postgres.id
    }
    key_vault = {
      name = "key-vault"
      id   = azurerm_key_vault.kv.id
    }
    service_bus = {
      name = "service-bus"
      id   = azurerm_servicebus_namespace.sb.id
    }
    acr = {
      name = "acr"
      id   = azurerm_container_registry.acr.id
    }
  }

  diagnostic_targets_storage = var.deploy_onboarding_frontend ? {
    storage = {
      name = "frontend-storage"
      id   = azurerm_storage_account.frontend[0].id
    }
  } : {}

  diagnostic_targets_apim = var.enable_apim_gateway ? {
    apim = {
      name = "apim"
      id   = azurerm_api_management.gateway[0].id
    }
  } : {}

  diagnostic_targets_container_apps = var.deploy_container_apps ? {
    container_apps_environment = {
      name = "container-apps-environment"
      id   = azurerm_container_app_environment.env[0].id
    }
  } : {}

  diagnostic_targets = merge(
    local.diagnostic_targets_base,
    local.diagnostic_targets_storage,
    local.diagnostic_targets_apim,
    local.diagnostic_targets_container_apps
  )
}

resource "terraform_data" "production_monitoring_precondition" {
  input = {
    environment            = var.environment
    external_action_group  = trimspace(var.monitor_action_group_id)
    notification_email     = trimspace(var.monitor_notification_email)
    monitoring_is_required = var.require_production_monitoring
  }

  lifecycle {
    precondition {
      condition = (
        lower(var.environment) != "prod" ||
        !var.require_production_monitoring ||
        trimspace(var.monitor_action_group_id) != "" ||
        trimspace(var.monitor_notification_email) != ""
      )
      error_message = "Production monitoring requires monitor_action_group_id or monitor_notification_email."
    }
  }
}

resource "azurerm_monitor_action_group" "operations" {
  count               = trimspace(var.monitor_action_group_id) == "" && trimspace(var.monitor_notification_email) != "" ? 1 : 0
  name                = "ag-${local.name_suffix}-operations"
  resource_group_name = azurerm_resource_group.rg.name
  short_name          = substr(replace("bev-${var.environment}", "_", "-"), 0, 12)
  enabled             = true
  tags                = local.common_tags

  email_receiver {
    name                    = "bevoac-operations"
    email_address           = trimspace(var.monitor_notification_email)
    use_common_alert_schema = true
  }
}

data "azurerm_monitor_diagnostic_categories" "critical" {
  for_each = var.enable_monitoring_diagnostics ? local.diagnostic_targets : {}

  resource_id = each.value.id
}

resource "azurerm_monitor_diagnostic_setting" "critical" {
  for_each = var.enable_monitoring_diagnostics ? local.diagnostic_targets : {}

  name                       = "diag-${local.name_suffix}-${each.value.name}"
  target_resource_id         = each.value.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.law.id

  dynamic "enabled_log" {
    for_each = toset(data.azurerm_monitor_diagnostic_categories.critical[each.key].log_category_types)
    content {
      category = enabled_log.value
    }
  }

  dynamic "enabled_metric" {
    for_each = toset(data.azurerm_monitor_diagnostic_categories.critical[each.key].metrics)
    content {
      category = enabled_metric.value
    }
  }
}

resource "azurerm_monitor_activity_log_alert" "resource_group_delete" {
  count               = var.enable_baseline_activity_alerts && local.monitor_action_group_id_effective != "" ? 1 : 0
  name                = "alert-${local.name_suffix}-resource-group-delete"
  resource_group_name = azurerm_resource_group.rg.name
  location            = "global"
  scopes              = [azurerm_resource_group.rg.id]
  description         = "Alert when deletion of the Bevoac production resource group is requested."
  enabled             = true
  tags                = local.common_tags

  criteria {
    category       = "Administrative"
    operation_name = "Microsoft.Resources/subscriptions/resourceGroups/delete"
  }

  action {
    action_group_id = local.monitor_action_group_id_effective
  }
}

resource "azurerm_monitor_activity_log_alert" "role_assignment_write" {
  count               = var.enable_baseline_activity_alerts && local.monitor_action_group_id_effective != "" ? 1 : 0
  name                = "alert-${local.name_suffix}-role-assignment-write"
  resource_group_name = azurerm_resource_group.rg.name
  location            = "global"
  scopes              = [azurerm_resource_group.rg.id]
  description         = "Alert when an Azure RBAC role assignment is created or changed in the Bevoac resource group."
  enabled             = true
  tags                = local.common_tags

  criteria {
    category       = "Administrative"
    operation_name = "Microsoft.Authorization/roleAssignments/write"
  }

  action {
    action_group_id = local.monitor_action_group_id_effective
  }
}

resource "azurerm_monitor_activity_log_alert" "role_assignment_delete" {
  count               = var.enable_baseline_activity_alerts && local.monitor_action_group_id_effective != "" ? 1 : 0
  name                = "alert-${local.name_suffix}-role-assignment-delete"
  resource_group_name = azurerm_resource_group.rg.name
  location            = "global"
  scopes              = [azurerm_resource_group.rg.id]
  description         = "Alert when an Azure RBAC role assignment is deleted in the Bevoac resource group."
  enabled             = true
  tags                = local.common_tags

  criteria {
    category       = "Administrative"
    operation_name = "Microsoft.Authorization/roleAssignments/delete"
  }

  action {
    action_group_id = local.monitor_action_group_id_effective
  }
}
