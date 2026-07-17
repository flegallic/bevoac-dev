resource "azurerm_container_app" "outbox_publisher" {
  count                        = var.deploy_container_apps && var.enable_dedicated_outbox_publisher ? 1 : 0
  name                         = "ca-${local.name_suffix}-outbox"
  container_app_environment_id = azurerm_container_app_environment.env[0].id
  workload_profile_name        = "Consumption"
  resource_group_name          = azurerm_resource_group.rg.name
  revision_mode                = "Single"
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
        value = var.pg_admin_username
      }
      env {
        name  = "PG_SSL_MODE"
        value = "verify-full"
      }
      env {
        name        = "PG_PASSWORD"
        secret_name = "pg-password"
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
        value = azurerm_user_assigned_identity.api.client_id
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
        value = "outbox-publisher-not-used"
      }
      env {
        name  = "API_PUBLIC_BASE_URL"
        value = local.api_public_base_url_effective
      }
    }
  }

  depends_on = [
    azurerm_role_assignment.api_acr_pull,
    azurerm_role_assignment.api_kv_reader,
    azurerm_role_assignment.api_sb_sender,
    azurerm_key_vault_secret.pg_password,
    time_sleep.wait_for_workload_roles
  ]
}
