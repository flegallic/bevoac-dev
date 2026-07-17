resource "azurerm_monitor_metric_alert" "servicebus_deadletter" {
  count               = var.monitor_action_group_id != "" ? 1 : 0
  name                = "alert-${local.name_suffix}-servicebus-dlq"
  resource_group_name = azurerm_resource_group.rg.name
  scopes              = [azurerm_servicebus_namespace.sb.id]
  description         = "Bevoac scan-jobs DLQ contains at least one message. Investigate and replay or purge explicitly."
  severity            = 2
  frequency           = "PT5M"
  window_size         = "PT5M"
  enabled             = true

  criteria {
    metric_namespace = "Microsoft.ServiceBus/namespaces"
    metric_name      = "DeadletteredMessages"
    aggregation      = "Maximum"
    operator         = "GreaterThan"
    threshold        = 0
    dimension {
      name     = "EntityName"
      operator = "Include"
      values   = [azurerm_servicebus_queue.scan_jobs.name]
    }
  }
  action {
    action_group_id = var.monitor_action_group_id
  }
  tags = local.common_tags
}

resource "azurerm_monitor_metric_alert" "servicebus_active_backlog" {
  count               = var.monitor_action_group_id != "" ? 1 : 0
  name                = "alert-${local.name_suffix}-servicebus-backlog"
  resource_group_name = azurerm_resource_group.rg.name
  scopes              = [azurerm_servicebus_namespace.sb.id]
  description         = "Bevoac scan-jobs backlog is growing. Check worker scale, sessions and Azure throttling."
  severity            = 3
  frequency           = "PT5M"
  window_size         = "PT15M"
  enabled             = true

  criteria {
    metric_namespace = "Microsoft.ServiceBus/namespaces"
    metric_name      = "ActiveMessages"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = 50
    dimension {
      name     = "EntityName"
      operator = "Include"
      values   = [azurerm_servicebus_queue.scan_jobs.name]
    }
  }
  action {
    action_group_id = var.monitor_action_group_id
  }
  tags = local.common_tags
}

resource "azurerm_monitor_metric_alert" "postgres_cpu" {
  count               = var.monitor_action_group_id != "" ? 1 : 0
  name                = "alert-${local.name_suffix}-postgres-cpu"
  resource_group_name = azurerm_resource_group.rg.name
  scopes              = [azurerm_postgresql_flexible_server.postgres.id]
  description         = "PostgreSQL CPU is high. Check scans, result storage and indexes."
  severity            = 3
  frequency           = "PT5M"
  window_size         = "PT15M"
  enabled             = true

  criteria {
    metric_namespace = "Microsoft.DBforPostgreSQL/flexibleServers"
    metric_name      = "cpu_percent"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = 80
  }
  action {
    action_group_id = var.monitor_action_group_id
  }
  tags = local.common_tags
}

resource "azurerm_monitor_metric_alert" "postgres_memory" {
  count               = var.monitor_action_group_id != "" ? 1 : 0
  name                = "alert-${local.name_suffix}-postgres-memory"
  resource_group_name = azurerm_resource_group.rg.name
  scopes              = [azurerm_postgresql_flexible_server.postgres.id]
  description         = "PostgreSQL memory is high. Check connection pools, long scans and result queries."
  severity            = 3
  frequency           = "PT5M"
  window_size         = "PT15M"
  enabled             = true

  criteria {
    metric_namespace = "Microsoft.DBforPostgreSQL/flexibleServers"
    metric_name      = "memory_percent"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = 85
  }
  action {
    action_group_id = var.monitor_action_group_id
  }
  tags = local.common_tags
}

resource "azurerm_monitor_metric_alert" "postgres_storage" {
  count               = var.monitor_action_group_id != "" ? 1 : 0
  name                = "alert-${local.name_suffix}-postgres-storage"
  resource_group_name = azurerm_resource_group.rg.name
  scopes              = [azurerm_postgresql_flexible_server.postgres.id]
  description         = "PostgreSQL storage usage is high. Check retention and scan_results growth."
  severity            = 2
  frequency           = "PT15M"
  window_size         = "PT30M"
  enabled             = true

  criteria {
    metric_namespace = "Microsoft.DBforPostgreSQL/flexibleServers"
    metric_name      = "storage_percent"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = 80
  }
  action {
    action_group_id = var.monitor_action_group_id
  }
  tags = local.common_tags
}
