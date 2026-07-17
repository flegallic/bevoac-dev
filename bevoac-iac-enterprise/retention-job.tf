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
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.api.id]
  }

  registry {
    server   = azurerm_container_registry.acr.login_server
    identity = azurerm_user_assigned_identity.api.id
  }

  secret {
    name                = "pg-password"
    identity            = azurerm_user_assigned_identity.api.id
    key_vault_secret_id = azurerm_key_vault_secret.pg_password.versionless_id
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
        value = var.pg_admin_username
      }
      env {
        name  = "PG_SSL_MODE"
        value = "verify-full"
      }
      env {
        name  = "SERVICEBUS_AUTH_MODE"
        value = "managed_identity"
      }
      env {
        name  = "SERVICEBUS_FQ_NAMESPACE"
        value = "${azurerm_servicebus_namespace.sb.name}.servicebus.windows.net"
      }
      env {
        name  = "SERVICEBUS_QUEUE_NAME"
        value = azurerm_servicebus_queue.scan_jobs.name
      }
      env {
        name  = "ADMIN_AUTH_MODE"
        value = var.admin_auth_mode
      }
      env {
        name  = "ADMIN_OIDC_ISSUER"
        value = var.admin_oidc_issuer
      }
      env {
        name  = "ADMIN_OIDC_AUDIENCE"
        value = var.admin_oidc_audience
      }
      env {
        name  = "ONBOARDING_STATE_SECRET"
        value = "retention-job-not-used"
      }
      env {
        name  = "API_PUBLIC_BASE_URL"
        value = local.api_public_base_url_effective
      }
      env {
        name  = "MICROSOFT_CLIENT_ID"
        value = var.microsoft_client_id
      }
      env {
        name        = "PG_PASSWORD"
        secret_name = "pg-password"
      }
    }
  }

  depends_on = [
    azurerm_role_assignment.api_acr_pull,
    azurerm_role_assignment.api_kv_reader,
    azurerm_key_vault_secret.pg_password,
    time_sleep.wait_for_workload_roles
  ]
}
