#!/usr/bin/env python3
"""Semantic gate for the staged Bevoac V6.1.3 Terraform plans.

The validator intentionally inspects only non-sensitive Terraform plan metadata.
It blocks stale/unsafe workload cutovers and incomplete security finalization.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Iterable

API = "azurerm_container_app.api[0]"
WORKER = "azurerm_container_app.worker[0]"
OUTBOX = "azurerm_container_app.outbox_publisher[0]"
RETENTION = "azurerm_container_app_job.retention[0]"
ADMIN = "azurerm_container_app.admin_api[0]"
KEY_VAULT = "azurerm_key_vault.kv"
POSTGRES = "azurerm_postgresql_flexible_server.postgres"
SERVICE_BUS = "azurerm_servicebus_namespace.sb"
LEGACY_SB_SECRET = "azurerm_key_vault_secret.servicebus_connection_string[0]"

MOVED_RESOURCES = {
    "azurerm_role_assignment.api_kv_reader[0]": "azurerm_role_assignment.api_kv_reader",
    "azurerm_role_assignment.worker_kv_reader[0]": "azurerm_role_assignment.worker_kv_reader",
    "azurerm_role_assignment.api_sb_sender[0]": "azurerm_role_assignment.api_sb_sender",
    "azurerm_role_assignment.api_legacy_admin_secret_reader[0]": "azurerm_role_assignment.api_legacy_admin_secret_reader",
    "azurerm_role_assignment.worker_servicebus_secret_reader[0]": "azurerm_role_assignment.worker_servicebus_secret_reader",
    "time_sleep.wait_for_workload_roles[0]": "time_sleep.wait_for_workload_roles",
}

SECURITY_DELETIONS_REQUIRED = {
    LEGACY_SB_SECRET,
    "azurerm_postgresql_flexible_server_firewall_rule.container_apps_egress[0]",
    "azurerm_role_assignment.api_kv_reader[0]",
    "azurerm_role_assignment.worker_kv_reader[0]",
    "azurerm_role_assignment.api_sb_sender[0]",
    "azurerm_role_assignment.api_legacy_admin_secret_reader[0]",
    "azurerm_role_assignment.worker_servicebus_secret_reader[0]",
    "time_sleep.wait_for_workload_roles[0]",
}

PRIVATE_NETWORK_RESOURCES = {
    "azurerm_subnet.private_endpoints[0]",
    "azurerm_private_dns_zone.kv[0]",
    "azurerm_private_dns_zone_virtual_network_link.kv[0]",
    "azurerm_private_endpoint.kv[0]",
    "azurerm_private_dns_zone.postgres[0]",
    "azurerm_private_dns_zone_virtual_network_link.postgres[0]",
    "azurerm_private_endpoint.postgres[0]",
}


def fail(message: str) -> "NoReturn":  # type: ignore[name-defined]
    raise SystemExit(f"BLOCKED: {message}")


def load_json(path: str) -> Any:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"cannot read JSON {path}: {exc}")


def changes(plan: dict[str, Any]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for item in plan.get("resource_changes") or []:
        address = item.get("address")
        if isinstance(address, str):
            result[address] = item
    return result


def item_at(items: dict[str, dict[str, Any]], address: str) -> dict[str, Any]:
    item = items.get(address)
    if item is None:
        fail(f"missing Terraform plan entry for {address}")
    return item


def action_tuple(item: dict[str, Any]) -> tuple[str, ...]:
    return tuple((item.get("change") or {}).get("actions") or [])


def before(item: dict[str, Any]) -> dict[str, Any]:
    value = (item.get("change") or {}).get("before")
    return value if isinstance(value, dict) else {}


def after(item: dict[str, Any]) -> dict[str, Any]:
    value = (item.get("change") or {}).get("after")
    return value if isinstance(value, dict) else {}


def changed_addresses(items: dict[str, dict[str, Any]]) -> set[str]:
    return {address for address, item in items.items() if action_tuple(item) != ("no-op",)}


def require_action(items: dict[str, dict[str, Any]], address: str, expected: Iterable[str]) -> None:
    actual = action_tuple(item_at(items, address))
    expected_tuple = tuple(expected)
    if actual != expected_tuple:
        fail(f"{address} actions are {actual}, expected {expected_tuple}")


def require_no_replacements(items: dict[str, dict[str, Any]]) -> None:
    replaced = sorted(
        address
        for address, item in items.items()
        if "create" in action_tuple(item) and "delete" in action_tuple(item)
    )
    if replaced:
        fail(f"resource replacements are forbidden: {', '.join(replaced)}")


def blocks(resource: dict[str, Any], key: str) -> list[dict[str, Any]]:
    value = resource.get(key) or []
    return [entry for entry in value if isinstance(entry, dict)]


def first_block(resource: dict[str, Any], key: str) -> dict[str, Any]:
    values = blocks(resource, key)
    return values[0] if values else {}


def secret_names(resource: dict[str, Any]) -> set[str]:
    return {str(entry.get("name")) for entry in blocks(resource, "secret") if entry.get("name")}


def identity_ids(resource: dict[str, Any]) -> set[str]:
    return {str(value) for value in first_block(resource, "identity").get("identity_ids") or []}


def require_identity_suffixes(resource: dict[str, Any], expected: set[str], label: str) -> None:
    actual = identity_ids(resource)
    missing = sorted(suffix for suffix in expected if not any(value.endswith(suffix) for value in actual))
    unexpected = sorted(value for value in actual if not any(value.endswith(suffix) for suffix in expected))
    if missing or unexpected or len(actual) != len(expected):
        fail(f"{label} identities mismatch; missing={missing}, unexpected={unexpected}")


def registry_identity(resource: dict[str, Any]) -> str:
    return str(first_block(resource, "registry").get("identity") or "")


def require_registry_identity(resource: dict[str, Any], suffix: str, label: str) -> None:
    actual = registry_identity(resource)
    if not actual.endswith(suffix):
        fail(f"{label} registry identity {actual!r} does not end with {suffix}")


def container(resource: dict[str, Any]) -> dict[str, Any]:
    return first_block(first_block(resource, "template"), "container")


def env_map(resource: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        str(entry.get("name")): entry
        for entry in blocks(container(resource), "env")
        if entry.get("name")
    }


def env_value(resource: dict[str, Any], name: str) -> Any:
    return env_map(resource).get(name, {}).get("value")


def env_secret(resource: dict[str, Any], name: str) -> Any:
    return env_map(resource).get(name, {}).get("secret_name")


def require_env(resource: dict[str, Any], *, values: dict[str, str], secrets: dict[str, str], label: str) -> None:
    for name, expected in values.items():
        actual = env_value(resource, name)
        if actual != expected:
            fail(f"{label} env {name} is {actual!r}, expected {expected!r}")
    for name, expected in secrets.items():
        actual = env_secret(resource, name)
        if actual != expected:
            fail(f"{label} secret env {name} is {actual!r}, expected {expected!r}")


def require_absent_env_prefixes(resource: dict[str, Any], prefixes: tuple[str, ...], label: str) -> None:
    names = set(env_map(resource))
    forbidden = sorted(name for name in names if any(name.startswith(prefix) for prefix in prefixes))
    if forbidden:
        fail(f"{label} contains forbidden env names: {', '.join(forbidden)}")


def require_secrets(resource: dict[str, Any], expected: set[str], label: str) -> None:
    actual = secret_names(resource)
    if actual != expected:
        fail(f"{label} Container Apps secrets are {sorted(actual)}, expected {sorted(expected)}")


def require_image(resource: dict[str, Any], expected: str, label: str) -> None:
    if "@sha256:" not in expected:
        fail(f"{label} expected image is not digest-pinned: {expected}")
    actual = container(resource).get("image")
    if actual != expected:
        fail(f"{label} image is {actual!r}, expected immutable ref {expected!r}")


def network_acl(resource: dict[str, Any]) -> dict[str, Any]:
    acl = first_block(resource, "network_acls")
    return {
        "public_network_access_enabled": resource.get("public_network_access_enabled"),
        "bypass": acl.get("bypass"),
        "default_action": acl.get("default_action"),
        "ip_rules": sorted(str(value) for value in acl.get("ip_rules") or []),
        "virtual_network_subnet_ids": sorted(
            str(value) for value in acl.get("virtual_network_subnet_ids") or []
        ),
    }


def require_kv_matches_vars(resource: dict[str, Any], variables: dict[str, Any]) -> None:
    actual = network_acl(resource)
    expected = {
        "public_network_access_enabled": variables.get("key_vault_public_network_access_enabled"),
        "bypass": variables.get("key_vault_network_bypass"),
        "default_action": variables.get("key_vault_network_default_action"),
        "ip_rules": sorted(str(value) for value in variables.get("key_vault_ip_rules") or []),
        "virtual_network_subnet_ids": sorted(
            str(value) for value in variables.get("key_vault_virtual_network_subnet_ids") or []
        ),
    }
    if actual != expected:
        fail(f"Key Vault network configuration does not match release variables: actual={actual}, expected={expected}")


def require_traffic(resource: dict[str, Any], expected: set[tuple[str, int]], label: str) -> None:
    ingress = first_block(resource, "ingress")
    weights = {
        (str(entry.get("revision_suffix") or ""), int(entry.get("percentage") or 0))
        for entry in blocks(ingress, "traffic_weight")
    }
    if weights != expected:
        fail(f"{label} traffic is {sorted(weights)}, expected {sorted(expected)}")


def validate_common_images(items: dict[str, dict[str, Any]], variables: dict[str, Any]) -> None:
    expected = {
        API: variables.get("api_image"),
        WORKER: variables.get("worker_image"),
        OUTBOX: variables.get("outbox_image"),
        RETENTION: variables.get("retention_image"),
        ADMIN: variables.get("admin_api_image") or variables.get("api_image"),
    }
    for address, image in expected.items():
        if not isinstance(image, str) or not image:
            fail(f"release variable for {address} image is missing")
        require_image(after(item_at(items, address)), image, address)


def validate_workloads(plan: dict[str, Any], variables: dict[str, Any]) -> None:
    items = changes(plan)
    require_no_replacements(items)

    expected_flags = {
        "retain_legacy_containerapp_rollback_compatibility": True,
        "retain_legacy_api_admin_secret_reader": True,
        "retain_legacy_servicebus_connection_secret": True,
        "retain_legacy_broad_key_vault_roles": True,
        "retain_legacy_api_servicebus_sender": True,
        "service_bus_local_auth_enabled": True,
    }
    for name, expected in expected_flags.items():
        if variables.get(name) is not expected:
            fail(f"workload release variable {name} must be {expected}")

    expected_actions = {
        ADMIN: ("create",),
        API: ("update",),
        WORKER: ("update",),
        OUTBOX: ("update",),
        RETENTION: ("update",),
    }
    for address, expected in expected_actions.items():
        require_action(items, address, expected)

    actual_changed = changed_addresses(items)
    if actual_changed != set(expected_actions):
        unexpected = sorted(actual_changed - set(expected_actions))
        missing = sorted(set(expected_actions) - actual_changed)
        fail(f"workload changed-resource set mismatch; unexpected={unexpected}, missing={missing}")

    for address, previous in MOVED_RESOURCES.items():
        item = item_at(items, address)
        require_action(items, address, ("no-op",))
        if item.get("previous_address") != previous:
            fail(f"{address} must move from {previous}, got {item.get('previous_address')}")

    validate_common_images(items, variables)

    api = after(item_at(items, API))
    require_identity_suffixes(api, {"/id-bevoac-prod-api"}, "public API")
    require_registry_identity(api, "/id-bevoac-prod-api", "public API")
    require_secrets(
        api,
        {"pg-password", "admin-api-secret", "pg-api-password", "microsoft-client-secret", "onboarding-state-secret"},
        "public API",
    )
    require_env(
        api,
        values={
            "NODE_ENV": "production",
            "APP_RUNTIME_MODE": "public_api",
            "PG_USER": "bevoac_api",
            "PG_SSL_MODE": "verify-full",
            "OUTBOX_PUBLISHER_ENABLED": "false",
            "OUTBOX_IMMEDIATE_PUBLISH_AFTER_REQUEST": "false",
        },
        secrets={"PG_PASSWORD": "pg-api-password"},
        label="public API",
    )
    require_absent_env_prefixes(api, ("ADMIN_", "SERVICEBUS_"), "public API")
    require_traffic(
        api,
        {
            (str(variables.get("api_stable_revision_suffix")), 100),
            (str(variables.get("api_revision_suffix")), 0),
        },
        "public API",
    )

    admin = after(item_at(items, ADMIN))
    require_identity_suffixes(admin, {"/id-bevoac-prod-admin-api"}, "admin API")
    require_registry_identity(admin, "/id-bevoac-prod-admin-api", "admin API")
    require_secrets(admin, {"pg-admin-api-password"}, "admin API")
    require_env(
        admin,
        values={
            "NODE_ENV": "production",
            "APP_RUNTIME_MODE": "admin_api",
            "ADMIN_AUTH_MODE": "oidc",
            "PG_USER": "bevoac_admin_api",
            "PG_SSL_MODE": "verify-full",
        },
        secrets={"PG_PASSWORD": "pg-admin-api-password"},
        label="admin API",
    )
    if first_block(admin, "ingress").get("external_enabled") is not False:
        fail("admin API ingress must be internal")

    worker = after(item_at(items, WORKER))
    require_identity_suffixes(worker, {"/id-bevoac-prod-worker"}, "worker")
    require_registry_identity(worker, "/id-bevoac-prod-worker", "worker")
    require_secrets(
        worker,
        {"pg-password", "servicebus-connection-string", "pg-worker-password", "microsoft-client-secret"},
        "worker",
    )
    require_env(
        worker,
        values={
            "NODE_ENV": "production",
            "PG_USER": "bevoac_worker",
            "PG_SSL_MODE": "verify-full",
            "SERVICEBUS_AUTH_MODE": "managed_identity",
        },
        secrets={"PG_PASSWORD": "pg-worker-password"},
        label="worker",
    )
    if "SERVICEBUS_CONNECTION_STRING" in env_map(worker):
        fail("worker must not consume a Service Bus connection string")
    scale_rules = blocks(first_block(worker, "template"), "custom_scale_rule")
    if len(scale_rules) != 1 or not str(scale_rules[0].get("identity_id") or "").endswith("/id-bevoac-prod-worker"):
        fail("worker Service Bus scale rule must use the worker managed identity")

    outbox = after(item_at(items, OUTBOX))
    require_identity_suffixes(outbox, {"/id-bevoac-prod-outbox", "/id-bevoac-prod-api"}, "outbox")
    require_registry_identity(outbox, "/id-bevoac-prod-outbox", "outbox")
    require_secrets(outbox, {"pg-password", "pg-outbox-password"}, "outbox")
    require_env(
        outbox,
        values={
            "NODE_ENV": "production",
            "APP_RUNTIME_MODE": "outbox",
            "PG_USER": "bevoac_outbox",
            "PG_SSL_MODE": "verify-full",
            "SERVICEBUS_AUTH_MODE": "managed_identity",
        },
        secrets={"PG_PASSWORD": "pg-outbox-password"},
        label="outbox",
    )

    retention = after(item_at(items, RETENTION))
    require_identity_suffixes(retention, {"/id-bevoac-prod-retention", "/id-bevoac-prod-api"}, "retention")
    require_registry_identity(retention, "/id-bevoac-prod-retention", "retention")
    require_secrets(retention, {"pg-password", "pg-retention-password"}, "retention")
    require_env(
        retention,
        values={
            "NODE_ENV": "production",
            "APP_RUNTIME_MODE": "retention",
            "DRY_RUN": "false",
            "PG_USER": "bevoac_retention",
            "PG_SSL_MODE": "verify-full",
        },
        secrets={"PG_PASSWORD": "pg-retention-password"},
        label="retention",
    )

    kv_item = item_at(items, KEY_VAULT)
    require_action(items, KEY_VAULT, ("no-op",))
    if network_acl(before(kv_item)) != network_acl(after(kv_item)):
        fail("workload phase changes Key Vault public access or network ACLs")
    require_kv_matches_vars(after(kv_item), variables)

    postgres_item = item_at(items, POSTGRES)
    require_action(items, POSTGRES, ("no-op",))
    if before(postgres_item).get("public_network_access_enabled") != after(postgres_item).get("public_network_access_enabled"):
        fail("workload phase changes PostgreSQL public network access")

    sb_item = item_at(items, SERVICE_BUS)
    require_action(items, SERVICE_BUS, ("no-op",))
    if after(sb_item).get("local_auth_enabled") is not True:
        fail("workload phase must preserve Service Bus local auth for rollback")

    require_action(items, LEGACY_SB_SECRET, ("no-op",))
    print("WORKLOAD_RELEASE_PLAN_OK=true")


def validate_security(plan: dict[str, Any], variables: dict[str, Any]) -> None:
    items = changes(plan)
    require_no_replacements(items)

    expected_flags = {
        "enable_private_endpoints": True,
        "enable_postgres_public_access": False,
        "enable_db_admin_public_ip_rule": False,
        "service_bus_local_auth_enabled": False,
        "retain_legacy_containerapp_rollback_compatibility": False,
        "retain_legacy_api_admin_secret_reader": False,
        "retain_legacy_servicebus_connection_secret": False,
        "retain_legacy_broad_key_vault_roles": False,
        "retain_legacy_api_servicebus_sender": False,
        "key_vault_public_network_access_enabled": False,
        "key_vault_network_bypass": "None",
        "key_vault_network_default_action": "Deny",
    }
    for name, expected in expected_flags.items():
        if variables.get(name) != expected:
            fail(f"security release variable {name} must be {expected!r}")
    if variables.get("key_vault_ip_rules") not in ([], None):
        fail("security phase must clear Key Vault IP rules")
    if variables.get("key_vault_virtual_network_subnet_ids") not in ([], None):
        fail("security phase must clear Key Vault VNet ACL rules")

    allowed_changed = {
        API,
        WORKER,
        OUTBOX,
        RETENTION,
        KEY_VAULT,
        POSTGRES,
        SERVICE_BUS,
        LEGACY_SB_SECRET,
        "azurerm_postgresql_flexible_server_firewall_rule.admin_ip[0]",
        "azurerm_postgresql_flexible_server_firewall_rule.container_apps_egress[0]",
        "azurerm_role_assignment.api_kv_reader[0]",
        "azurerm_role_assignment.worker_kv_reader[0]",
        "azurerm_role_assignment.api_sb_sender[0]",
        "azurerm_role_assignment.api_legacy_admin_secret_reader[0]",
        "azurerm_role_assignment.worker_servicebus_secret_reader[0]",
        "time_sleep.wait_for_workload_roles[0]",
    } | PRIVATE_NETWORK_RESOURCES

    unexpected = sorted(changed_addresses(items) - allowed_changed)
    if unexpected:
        fail(f"security plan changes unapproved resources: {', '.join(unexpected)}")

    for address in (API, WORKER, OUTBOX, RETENTION, KEY_VAULT, POSTGRES, SERVICE_BUS):
        require_action(items, address, ("update",))
    require_action(items, ADMIN, ("no-op",))

    admin_firewall = items.get("azurerm_postgresql_flexible_server_firewall_rule.admin_ip[0]")
    if admin_firewall is not None and action_tuple(admin_firewall) != ("no-op",):
        require_action(items, "azurerm_postgresql_flexible_server_firewall_rule.admin_ip[0]", ("delete",))

    for address in SECURITY_DELETIONS_REQUIRED:
        require_action(items, address, ("delete",))

    for address in PRIVATE_NETWORK_RESOURCES:
        action = action_tuple(item_at(items, address))
        if action not in (("create",), ("no-op",)):
            fail(f"{address} must be created or already present, got {action}")

    validate_common_images(items, variables)

    api = after(item_at(items, API))
    require_identity_suffixes(api, {"/id-bevoac-prod-api"}, "public API")
    require_registry_identity(api, "/id-bevoac-prod-api", "public API")
    require_secrets(api, {"pg-api-password", "microsoft-client-secret", "onboarding-state-secret"}, "public API")
    require_env(
        api,
        values={"APP_RUNTIME_MODE": "public_api", "PG_USER": "bevoac_api", "PG_SSL_MODE": "verify-full"},
        secrets={"PG_PASSWORD": "pg-api-password"},
        label="public API",
    )
    require_absent_env_prefixes(api, ("ADMIN_", "SERVICEBUS_"), "public API")
    candidate = str(variables.get("api_revision_suffix"))
    stable = str(variables.get("api_stable_revision_suffix"))
    if candidate != stable or not candidate:
        fail("security phase must pin stable and candidate suffix to the promoted revision")
    require_traffic(api, {(candidate, 100)}, "public API")

    worker = after(item_at(items, WORKER))
    require_identity_suffixes(worker, {"/id-bevoac-prod-worker"}, "worker")
    require_registry_identity(worker, "/id-bevoac-prod-worker", "worker")
    require_secrets(worker, {"pg-worker-password", "microsoft-client-secret"}, "worker")
    require_env(
        worker,
        values={"PG_USER": "bevoac_worker", "SERVICEBUS_AUTH_MODE": "managed_identity"},
        secrets={"PG_PASSWORD": "pg-worker-password"},
        label="worker",
    )
    if "SERVICEBUS_CONNECTION_STRING" in env_map(worker):
        fail("worker must not consume a Service Bus connection string")

    outbox = after(item_at(items, OUTBOX))
    require_identity_suffixes(outbox, {"/id-bevoac-prod-outbox"}, "outbox")
    require_registry_identity(outbox, "/id-bevoac-prod-outbox", "outbox")
    require_secrets(outbox, {"pg-outbox-password"}, "outbox")
    require_env(
        outbox,
        values={"APP_RUNTIME_MODE": "outbox", "PG_USER": "bevoac_outbox", "SERVICEBUS_AUTH_MODE": "managed_identity"},
        secrets={"PG_PASSWORD": "pg-outbox-password"},
        label="outbox",
    )

    retention = after(item_at(items, RETENTION))
    require_identity_suffixes(retention, {"/id-bevoac-prod-retention"}, "retention")
    require_registry_identity(retention, "/id-bevoac-prod-retention", "retention")
    require_secrets(retention, {"pg-retention-password"}, "retention")
    require_env(
        retention,
        values={"APP_RUNTIME_MODE": "retention", "PG_USER": "bevoac_retention", "DRY_RUN": "false"},
        secrets={"PG_PASSWORD": "pg-retention-password"},
        label="retention",
    )

    admin = after(item_at(items, ADMIN))
    require_identity_suffixes(admin, {"/id-bevoac-prod-admin-api"}, "admin API")
    require_registry_identity(admin, "/id-bevoac-prod-admin-api", "admin API")
    require_secrets(admin, {"pg-admin-api-password"}, "admin API")
    if first_block(admin, "ingress").get("external_enabled") is not False:
        fail("admin API ingress must remain internal")

    kv = after(item_at(items, KEY_VAULT))
    require_kv_matches_vars(kv, variables)
    if network_acl(kv) != {
        "public_network_access_enabled": False,
        "bypass": "None",
        "default_action": "Deny",
        "ip_rules": [],
        "virtual_network_subnet_ids": [],
    }:
        fail("Key Vault final network posture is not private/default-deny")

    if after(item_at(items, POSTGRES)).get("public_network_access_enabled") is not False:
        fail("PostgreSQL public network access must be disabled")
    if after(item_at(items, SERVICE_BUS)).get("local_auth_enabled") is not False:
        fail("Service Bus local authentication must be disabled")

    print("SECURITY_RELEASE_PLAN_OK=true")


def main() -> None:
    if len(sys.argv) != 4:
        fail("usage: validate-release-plan.py workloads|security PLAN_JSON RELEASE_VARS_JSON")
    phase, plan_path, vars_path = sys.argv[1:]
    plan = load_json(plan_path)
    variables = load_json(vars_path)
    if not isinstance(plan, dict) or not isinstance(variables, dict):
        fail("plan and release variables must be JSON objects")
    if phase == "workloads":
        validate_workloads(plan, variables)
    elif phase == "security":
        validate_security(plan, variables)
    else:
        fail(f"unsupported phase: {phase}")


if __name__ == "__main__":
    main()
