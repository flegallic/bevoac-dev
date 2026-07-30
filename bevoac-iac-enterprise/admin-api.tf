# Dedicated administration API. Internal ingress by default; access through a private network or approved gateway.
resource "azurerm_container_app" "admin_api" {
  count                        = var.deploy_container_apps && var.enable_dedicated_admin_api ? 1 : 0
  name                         = "ca-${local.name_suffix}-admin-api"
  container_app_environment_id = azurerm_container_app_environment.env[0].id
  workload_profile_name        = "Consumption"
  resource_group_name          = azurerm_resource_group.rg.name
  revision_mode                = "Single"
  tags                         = local.common_tags

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.admin_api.id]
  }

  registry {
    server   = azurerm_container_registry.acr.login_server
    identity = azurerm_user_assigned_identity.admin_api.id
  }

  secret {
    name                = "pg-admin-api-password"
    identity            = azurerm_user_assigned_identity.admin_api.id
    key_vault_secret_id = azurerm_key_vault_secret.pg_admin_api_password.versionless_id
  }

  ingress {
    external_enabled = false
    target_port      = 8080
    transport        = "auto"
    traffic_weight {
      percentage      = 100
      latest_revision = true
    }
  }

  template {
    min_replicas = 1
    max_replicas = 2

    container {
      name   = "admin-api"
      image  = var.admin_api_image != "" ? var.admin_api_image : var.api_image
      cpu    = 0.5
      memory = "1Gi"

      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "APP_RUNTIME_MODE"
        value = "admin_api"
      }
      env {
        name  = "HOST"
        value = "0.0.0.0"
      }
      env {
        name  = "PORT"
        value = "8080"
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
        value = "bevoac_admin_api"
      }
      env {
        name  = "PG_SSL_MODE"
        value = "verify-full"
      }
      env {
        name  = "ADMIN_AUTH_MODE"
        value = "oidc"
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
        name  = "ADMIN_OIDC_REQUIRED_ROLES"
        value = var.admin_oidc_required_roles
      }
      env {
        name        = "PG_PASSWORD"
        secret_name = "pg-admin-api-password"
      }
    }
  }

  depends_on = [
    azurerm_role_assignment.admin_api_acr_pull,
    azurerm_role_assignment.admin_api_pg_secret_reader,
    azurerm_key_vault_secret.pg_admin_api_password,
    time_sleep.wait_for_dedicated_workload_roles
  ]
}
