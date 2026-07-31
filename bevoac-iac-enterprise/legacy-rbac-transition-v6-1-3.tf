# Preserve existing Terraform addresses during the staged V6.1.3 migration.
# The workload phase keeps these resources at index [0]. The security-finalize
# phase removes them only after dedicated secret-scoped roles and outbox Sender
# access have been verified.

moved {
  from = azurerm_role_assignment.api_kv_reader
  to   = azurerm_role_assignment.api_kv_reader[0]
}

moved {
  from = azurerm_role_assignment.worker_kv_reader
  to   = azurerm_role_assignment.worker_kv_reader[0]
}

moved {
  from = azurerm_role_assignment.api_sb_sender
  to   = azurerm_role_assignment.api_sb_sender[0]
}

moved {
  from = time_sleep.wait_for_workload_roles
  to   = time_sleep.wait_for_workload_roles[0]
}

moved {
  from = azurerm_role_assignment.api_legacy_admin_secret_reader
  to   = azurerm_role_assignment.api_legacy_admin_secret_reader[0]
}

moved {
  from = azurerm_role_assignment.worker_servicebus_secret_reader
  to   = azurerm_role_assignment.worker_servicebus_secret_reader[0]
}
