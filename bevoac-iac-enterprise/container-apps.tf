locals {
  api_env_plain = [
    { name = "NODE_ENV", value = "production" },
    { name = "HOST", value = "0.0.0.0" },
    { name = "PORT", value = "8080" },
    { name = "LOG_LEVEL", value = "info" },
    { name = "DEFAULT_PLAN_FREE_QUOTA", value = "30" },
    { name = "DEFAULT_PLAN_STANDARD_QUOTA", value = "2500" },
    { name = "DEFAULT_PLAN_BUSINESS_QUOTA", value = "10000" },
    { name = "DEFAULT_PLAN_FREE_RESOURCE_LIMIT", value = "10" },
    { name = "DEFAULT_PLAN_STANDARD_RESOURCE_LIMIT", value = "500" },
    { name = "DEFAULT_PLAN_BUSINESS_RESOURCE_LIMIT", value = "2500" },
    { name = "ACTIVE_SCAN_LIMIT_FREE", value = tostring(var.active_scan_limits.free) },
    { name = "ACTIVE_SCAN_LIMIT_STANDARD", value = tostring(var.active_scan_limits.standard) },
    { name = "ACTIVE_SCAN_LIMIT_BUSINESS", value = tostring(var.active_scan_limits.business) },
    { name = "ACTIVE_SCAN_LIMIT_PAYG", value = tostring(var.active_scan_limits.payg) },
    { name = "MAX_RESULT_JSON_BYTES", value = tostring(var.max_result_json_bytes) },
    { name = "PDF_GENERATION_TIMEOUT_MS", value = tostring(var.pdf_generation_timeout_ms) },
    { name = "PDF_MAX_INPUT_JSON_BYTES", value = tostring(var.pdf_max_input_json_bytes) },
    { name = "ALLOWED_ORIGINS", value = local.allowed_origins_csv },
    { name = "PG_HOST", value = azurerm_postgresql_flexible_server.postgres.fqdn },
    { name = "PG_PORT", value = "5432" },
    { name = "PG_DATABASE", value = "postgres" },
    { name = "PG_USER", value = var.pg_admin_username },
    { name = "PG_SSL_MODE", value = "verify-full" },
    { name = "SERVICEBUS_AUTH_MODE", value = "managed_identity" },
    { name = "SERVICEBUS_FQ_NAMESPACE", value = "${azurerm_servicebus_namespace.sb.name}.servicebus.windows.net" },
    { name = "SERVICEBUS_QUEUE_NAME", value = azurerm_servicebus_queue.scan_jobs.name },
    { name = "SERVICEBUS_SESSIONS_ENABLED", value = tostring(var.enable_service_bus_sessions) },
    { name = "OUTBOX_PUBLISHER_ENABLED", value = tostring(!var.enable_dedicated_outbox_publisher) },
    { name = "OUTBOX_IMMEDIATE_PUBLISH_AFTER_REQUEST", value = tostring(!var.enable_dedicated_outbox_publisher) },
    { name = "OUTBOX_PUBLISH_INTERVAL_MS", value = tostring(var.outbox_publish_interval_ms) },
    { name = "OUTBOX_PUBLISH_BATCH_SIZE", value = tostring(var.outbox_publish_batch_size) },
    { name = "OUTBOX_MAX_ATTEMPTS", value = tostring(var.outbox_max_attempts) },
    { name = "OUTBOX_BASE_BACKOFF_SECONDS", value = tostring(var.outbox_base_backoff_seconds) },
    { name = "AZURE_CLIENT_ID", value = azurerm_user_assigned_identity.api.client_id },
    { name = "ADMIN_AUTH_MODE", value = var.admin_auth_mode },
    { name = "ADMIN_OIDC_ISSUER", value = var.admin_oidc_issuer },
    { name = "ADMIN_OIDC_AUDIENCE", value = var.admin_oidc_audience },
    { name = "ADMIN_OIDC_REQUIRED_ROLES", value = var.admin_oidc_required_roles },
    { name = "MICROSOFT_CLIENT_ID", value = var.microsoft_client_id },
    { name = "MICROSOFT_ADMIN_CONSENT_SCOPE", value = "https://graph.microsoft.com/.default" },
    { name = "API_PUBLIC_BASE_URL", value = local.api_public_base_url_effective },
    { name = "ONBOARDING_REDIRECT_URI", value = local.onboarding_redirect_callback_uri_effective },
    { name = "ONBOARDING_FRONTEND_SUCCESS_URL", value = local.onboarding_success_url },
    { name = "ONBOARDING_ALLOW_INFER_REDIRECT_URI", value = "false" },
    { name = "ONBOARDING_STATE_TTL_MINUTES", value = "20" },
    { name = "ONBOARDING_AZURE_REQUEST_TIMEOUT_MS", value = "15000" }
  ]

  api_env_secret = [
    { name = "PG_PASSWORD", secret_name = "pg-password" },
    { name = "ADMIN_API_SECRET", secret_name = "admin-api-secret" },
    { name = "MICROSOFT_CLIENT_SECRET", secret_name = "microsoft-client-secret" },
    { name = "ONBOARDING_STATE_SECRET", secret_name = "onboarding-state-secret" }
  ]

  worker_env_plain = [
    { name = "NODE_ENV", value = "production" },
    { name = "LOG_LEVEL", value = "info" },
    { name = "WORKER_NAME", value = "bevoac-worker-enterprise" },
    { name = "DEFAULT_PLAN_FREE_RESOURCE_LIMIT", value = "10" },
    { name = "DEFAULT_PLAN_STANDARD_RESOURCE_LIMIT", value = "500" },
    { name = "DEFAULT_PLAN_BUSINESS_RESOURCE_LIMIT", value = "2500" },
    { name = "AZURE_CLIENT_ID", value = azurerm_user_assigned_identity.worker.client_id },
    { name = "SERVICEBUS_AUTH_MODE", value = "managed_identity" },
    { name = "SERVICEBUS_FQ_NAMESPACE", value = "${azurerm_servicebus_namespace.sb.name}.servicebus.windows.net" },
    { name = "SERVICEBUS_QUEUE_NAME", value = azurerm_servicebus_queue.scan_jobs.name },
    { name = "SERVICEBUS_SESSIONS_ENABLED", value = tostring(var.enable_service_bus_sessions) },
    { name = "OUTBOX_PUBLISHER_ENABLED", value = tostring(!var.enable_dedicated_outbox_publisher) },
    { name = "OUTBOX_IMMEDIATE_PUBLISH_AFTER_REQUEST", value = tostring(!var.enable_dedicated_outbox_publisher) },
    { name = "OUTBOX_PUBLISH_INTERVAL_MS", value = tostring(var.outbox_publish_interval_ms) },
    { name = "OUTBOX_PUBLISH_BATCH_SIZE", value = tostring(var.outbox_publish_batch_size) },
    { name = "OUTBOX_MAX_ATTEMPTS", value = tostring(var.outbox_max_attempts) },
    { name = "OUTBOX_BASE_BACKOFF_SECONDS", value = tostring(var.outbox_base_backoff_seconds) },
    { name = "MAX_CONCURRENT_TENANT_SESSIONS", value = tostring(var.max_concurrent_tenant_sessions) },
    { name = "MAX_RESULT_JSON_BYTES", value = tostring(var.max_result_json_bytes) },
    { name = "RESULT_COMPRESSION_THRESHOLD_BYTES", value = "524288" },
    { name = "TIMEOUT_WEB_HEADERS_MS", value = "10000" },
    { name = "TIMEOUT_WEB_DNS_MS", value = "8000" },
    { name = "TIMEOUT_WEB_TLS_MS", value = "10000" },
    { name = "TIMEOUT_WEB_NMAP_MS", value = "30000" },
    { name = "TIMEOUT_ENTRA_MS", value = "60000" },
    { name = "TIMEOUT_AZURE_INFRA_MS", value = "120000" },
    { name = "TIMEOUT_RESOURCE_PREFLIGHT_MS", value = "30000" },
    { name = "WEB_MAX_REDIRECTS", value = "2" },
    { name = "WEB_BLOCKED_HOSTS", value = "localhost,localhost.localdomain" },
    { name = "MICROSOFT_CLIENT_ID", value = var.microsoft_client_id },
    { name = "PG_HOST", value = azurerm_postgresql_flexible_server.postgres.fqdn },
    { name = "PG_PORT", value = "5432" },
    { name = "PG_DATABASE", value = "postgres" },
    { name = "PG_USER", value = var.pg_admin_username },
    { name = "PG_SSL_MODE", value = "verify-full" }
  ]

  worker_env_secret = [
    { name = "PG_PASSWORD", secret_name = "pg-password" },
    { name = "MICROSOFT_CLIENT_SECRET", secret_name = "microsoft-client-secret" }
  ]
}

resource "azurerm_container_app_environment" "env" {
  count                      = var.deploy_container_apps ? 1 : 0
  name                       = "cae-${local.name_suffix}"
  location                   = azurerm_resource_group.rg.location
  resource_group_name        = azurerm_resource_group.rg.name
  log_analytics_workspace_id = azurerm_log_analytics_workspace.law.id
  infrastructure_subnet_id   = azurerm_subnet.aca.id
  tags                       = local.common_tags

  # lifecycle temporarily disabled for full POC teardown.
  # Re-enable prevent_destroy before rebuilding production.
  lifecycle {
    prevent_destroy = true
    ignore_changes  = [infrastructure_resource_group_name, workload_profile]
  }
}

resource "azurerm_container_app" "api" {
  count                        = var.deploy_container_apps ? 1 : 0
  name                         = local.api_container_app_name
  container_app_environment_id = azurerm_container_app_environment.env[0].id
  workload_profile_name        = "Consumption"
  resource_group_name          = azurerm_resource_group.rg.name
  revision_mode                = "Multiple"
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
  secret {
    name                = "admin-api-secret"
    identity            = azurerm_user_assigned_identity.api.id
    key_vault_secret_id = azurerm_key_vault_secret.admin_api_secret.versionless_id
  }
  secret {
    name                = "microsoft-client-secret"
    identity            = azurerm_user_assigned_identity.api.id
    key_vault_secret_id = azurerm_key_vault_secret.microsoft_client_secret.versionless_id
  }
  secret {
    name                = "onboarding-state-secret"
    identity            = azurerm_user_assigned_identity.api.id
    key_vault_secret_id = azurerm_key_vault_secret.onboarding_state_secret.versionless_id
  }

  ingress {
    external_enabled = true
    target_port      = 8080
    transport        = "auto"
    traffic_weight {
      percentage      = 100
      latest_revision = false
      revision_suffix = "0000001"
    }
  }

  template {
    min_replicas = 1
    max_replicas = 5

    container {
      name   = "api"
      image  = var.api_image
      cpu    = 1.0
      memory = "2Gi"

      dynamic "env" {
        for_each = { for e in local.api_env_plain : e.name => e }
        content {
          name  = env.value.name
          value = env.value.value
        }
      }

      dynamic "env" {
        for_each = { for e in local.api_env_secret : e.name => e }
        content {
          name        = env.value.name
          secret_name = env.value.secret_name
        }
      }
    }
  }

  depends_on = [
    azurerm_role_assignment.api_acr_pull,
    azurerm_role_assignment.api_kv_reader,
    azurerm_role_assignment.api_sb_sender,
    time_sleep.wait_for_workload_roles,
    azurerm_key_vault_secret.pg_password,
    azurerm_key_vault_secret.admin_api_secret,
    azurerm_key_vault_secret.microsoft_client_secret,
    azurerm_key_vault_secret.onboarding_state_secret
  ]
}

resource "azurerm_container_app" "worker" {
  count                        = var.deploy_container_apps ? 1 : 0
  name                         = local.worker_container_app_name
  container_app_environment_id = azurerm_container_app_environment.env[0].id
  workload_profile_name        = "Consumption"
  resource_group_name          = azurerm_resource_group.rg.name
  revision_mode                = "Single"
  tags                         = local.common_tags

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.worker.id]
  }

  registry {
    server   = azurerm_container_registry.acr.login_server
    identity = azurerm_user_assigned_identity.worker.id
  }

  secret {
    name                = "pg-password"
    identity            = azurerm_user_assigned_identity.worker.id
    key_vault_secret_id = azurerm_key_vault_secret.pg_password.versionless_id
  }
  secret {
    name                = "microsoft-client-secret"
    identity            = azurerm_user_assigned_identity.worker.id
    key_vault_secret_id = azurerm_key_vault_secret.microsoft_client_secret.versionless_id
  }
  secret {
    name                = "servicebus-connection-string"
    identity            = azurerm_user_assigned_identity.worker.id
    key_vault_secret_id = azurerm_key_vault_secret.servicebus_connection_string.versionless_id
  }

  template {
    min_replicas = 0
    max_replicas = 8

    custom_scale_rule {
      name             = "servicebus-queue-scale"
      custom_rule_type = "azure-servicebus"
      metadata = {
        namespace    = azurerm_servicebus_namespace.sb.name
        queueName    = azurerm_servicebus_queue.scan_jobs.name
        messageCount = "1"
      }
      authentication {
        secret_name       = "servicebus-connection-string"
        trigger_parameter = "connection"
      }
    }

    container {
      name   = "worker"
      image  = var.worker_image
      cpu    = 1.0
      memory = "2Gi"

      dynamic "env" {
        for_each = { for e in local.worker_env_plain : e.name => e }
        content {
          name  = env.value.name
          value = env.value.value
        }
      }

      dynamic "env" {
        for_each = { for e in local.worker_env_secret : e.name => e }
        content {
          name        = env.value.name
          secret_name = env.value.secret_name
        }
      }
    }
  }

  depends_on = [
    azurerm_role_assignment.worker_acr_pull,
    azurerm_role_assignment.worker_kv_reader,
    azurerm_role_assignment.worker_sb_receiver,
    time_sleep.wait_for_workload_roles,
    azurerm_key_vault_secret.pg_password,
    azurerm_key_vault_secret.microsoft_client_secret,
    azurerm_key_vault_secret.servicebus_connection_string
  ]
}
