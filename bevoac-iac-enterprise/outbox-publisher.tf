resource "azurerm_container_app" "outbox_publisher" {
  count                        = var.deploy_container_apps && var.enable_dedicated_outbox_publisher ? 1 : 0
  name                         = "ca-${local.name_suffix}-outbox"
  container_app_environment_id = azurerm_container_app_environment.env[0].id
  workload_profile_name        = "Consumption"
  resource_group_name          = azurerm_resource_group.rg.name
  revision_mode                = "Single"
  tags                         = local.common_tags

  identity {
    type = "UserAssigned"
    identity_ids = concat(
      [azurerm_user_assigned_identity.outbox.id],
      var.retain_legacy_containerapp_rollback_compatibility ? [azurerm_user_assigned_identity.api.id] : [],
    )
  }

  registry {
    server   = azurerm_container_registry.acr.login_server
    identity = azurerm_user_assigned_identity.outbox.id
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
    name                = "pg-outbox-password"
    identity            = azurerm_user_assigned_identity.outbox.id
    key_vault_secret_id = azurerm_key_vault_secret.pg_outbox_password.versionless_id
  }

  template {
    min_replicas = var.outbox_publisher_min_replicas
    max_replicas = var.outbox_publisher_max_replicas

    container {
      name    = "outbox-publisher"
      image   = var.outbox_image
      cpu     = 0.5
      memory  = "1Gi"
      command = ["node", "scripts/outbox-publisher-daemon.js"]

      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "APP_RUNTIME_MODE"
        value = "outbox"
      }
      env {
        name  = "LOG_LEVEL"
        value = "info"
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
        value = "bevoac_outbox"
      }
      env {
        name  = "PG_SSL_MODE"
        value = "verify-full"
      }
      env {
        name        = "PG_PASSWORD"
        secret_name = "pg-outbox-password"
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
        name  = "SERVICEBUS_SESSIONS_ENABLED"
        value = tostring(var.enable_service_bus_sessions)
      }
      env {
        name  = "AZURE_CLIENT_ID"
        value = azurerm_user_assigned_identity.outbox.client_id
      }
      env {
        name  = "OUTBOX_PUBLISH_INTERVAL_MS"
        value = tostring(var.outbox_publish_interval_ms)
      }
      env {
        name  = "OUTBOX_PUBLISH_BATCH_SIZE"
        value = tostring(var.outbox_publish_batch_size)
      }
      env {
        name  = "OUTBOX_MAX_ATTEMPTS"
        value = tostring(var.outbox_max_attempts)
      }
      env {
        name  = "OUTBOX_BASE_BACKOFF_SECONDS"
        value = tostring(var.outbox_base_backoff_seconds)
      }
    }
  }

  lifecycle {
    precondition {
      condition     = !var.retain_legacy_containerapp_rollback_compatibility || var.retain_legacy_broad_key_vault_roles
      error_message = "Outbox rollback compatibility requires the legacy API Key Vault role."
    }
  }

  depends_on = [
    azurerm_role_assignment.outbox_acr_pull,
    azurerm_role_assignment.outbox_pg_secret_reader,
    azurerm_role_assignment.outbox_sb_sender,
    azurerm_role_assignment.api_kv_reader,
    time_sleep.wait_for_workload_roles,
    azurerm_key_vault_secret.pg_password,
    azurerm_key_vault_secret.pg_outbox_password,
    time_sleep.wait_for_dedicated_workload_roles
  ]
}
