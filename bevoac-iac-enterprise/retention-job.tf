resource "azurerm_container_app_job" "retention" {
  count                        = var.deploy_container_apps && var.enable_retention_scheduler ? 1 : 0
  name                         = "job-${local.name_suffix}-retention"
  location                     = azurerm_resource_group.rg.location
  resource_group_name          = azurerm_resource_group.rg.name
  container_app_environment_id = azurerm_container_app_environment.env[0].id
  workload_profile_name        = "Consumption"
  replica_timeout_in_seconds   = 1800
  replica_retry_limit          = 1
  tags                         = local.common_tags

  identity {
    type = "UserAssigned"
    identity_ids = concat(
      [azurerm_user_assigned_identity.retention.id],
      var.retain_legacy_containerapp_rollback_compatibility ? [azurerm_user_assigned_identity.api.id] : [],
    )
  }

  registry {
    server   = azurerm_container_registry.acr.login_server
    identity = azurerm_user_assigned_identity.retention.id
  }

  dynamic "secret" {
    for_each = var.retain_legacy_containerapp_rollback_compatibility ? [1] : []
    content {
      name                = "pg-password"
      identity            = azurerm_user_assigned_identity.api.id
      key_vault_secret_id = azurerm_key_vault_secret.pg_password.versionless_id
    }
  }
  secret {
    name                = "pg-retention-password"
    identity            = azurerm_user_assigned_identity.retention.id
    key_vault_secret_id = azurerm_key_vault_secret.pg_retention_password.versionless_id
  }

  schedule_trigger_config {
    cron_expression          = var.retention_cron_expression
    parallelism              = 1
    replica_completion_count = 1
  }

  template {
    container {
      name    = "retention"
      image   = var.retention_image
      cpu     = 0.5
      memory  = "1Gi"
      command = ["node", "scripts/retention-sweep.js"]

      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "APP_RUNTIME_MODE"
        value = "retention"
      }
      env {
        name  = "DRY_RUN"
        value = "false"
      }
      env {
        name  = "SCAN_RESULT_RETENTION_DAYS"
        value = tostring(var.retention_done_days)
      }
      env {
        name  = "SCAN_RESULT_RETENTION_DAYS_FREE"
        value = tostring(var.retention_done_days_free)
      }
      env {
        name  = "SCAN_RESULT_RETENTION_DAYS_STANDARD"
        value = tostring(var.retention_done_days_standard)
      }
      env {
        name  = "SCAN_RESULT_RETENTION_DAYS_BUSINESS"
        value = tostring(var.retention_done_days_business)
      }
      env {
        name  = "SCAN_RESULT_RETENTION_DAYS_PAYG"
        value = tostring(var.retention_done_days_payg)
      }
      env {
        name  = "FAILED_SCAN_RETENTION_DAYS"
        value = tostring(var.retention_failed_days)
      }
      env {
        name  = "PG_HOST"
        value = azurerm_postgresql_flexible_server.postgres.fqdn
      }
      env {
        name  = "PG_PORT"
        value = "5432"
      }
      env {
        name  = "PG_DATABASE"
        value = "postgres"
      }
      env {
        name  = "PG_USER"
        value = "bevoac_retention"
      }
      env {
        name  = "PG_SSL_MODE"
        value = "verify-full"
      }
      env {
        name        = "PG_PASSWORD"
        secret_name = "pg-retention-password"
      }
    }
  }

  lifecycle {
    precondition {
      condition     = !var.retain_legacy_containerapp_rollback_compatibility || var.retain_legacy_broad_key_vault_roles
      error_message = "Retention rollback compatibility requires the legacy API Key Vault role."
    }
  }

  depends_on = [
    azurerm_role_assignment.retention_acr_pull,
    azurerm_role_assignment.retention_pg_secret_reader,
    azurerm_role_assignment.api_kv_reader,
    time_sleep.wait_for_workload_roles,
    azurerm_key_vault_secret.pg_password,
    azurerm_key_vault_secret.pg_retention_password,
    time_sleep.wait_for_dedicated_workload_roles
  ]
}
