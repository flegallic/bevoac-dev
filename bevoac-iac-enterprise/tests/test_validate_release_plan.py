from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VALIDATOR = ROOT / "scripts" / "validate-release-plan.py"
API_IMAGE = "acr.example.invalid/bevoac-api-enterprise@sha256:" + "a" * 64
WORKER_IMAGE = "acr.example.invalid/bevoac-worker-enterprise@sha256:" + "b" * 64


def env_value(name: str, value: str) -> dict:
    return {"name": name, "value": value}


def env_secret(name: str, secret_name: str) -> dict:
    return {"name": name, "secret_name": secret_name}


def app(
    *,
    image: str,
    identities: list[str],
    registry_identity: str,
    secrets: list[str],
    env: list[dict],
    ingress: list[dict] | None = None,
    scale_identity: str | None = None,
) -> dict:
    template = {
        "container": [{"image": image, "env": env}],
        "custom_scale_rule": [],
    }
    if scale_identity:
        template["custom_scale_rule"] = [{"identity_id": scale_identity}]
    result = {
        "identity": [{"identity_ids": identities}],
        "registry": [{"identity": registry_identity}],
        "secret": [{"name": name} for name in secrets],
        "template": [template],
    }
    if ingress is not None:
        result["ingress"] = [{"traffic_weight": ingress, "external_enabled": True}]
    return result


def change(address: str, actions: list[str], after: dict | None = None, before: dict | None = None, previous: str | None = None) -> dict:
    item = {
        "address": address,
        "change": {"actions": actions, "before": before, "after": after},
    }
    if previous:
        item["previous_address"] = previous
    return item


def kv(public: bool, bypass: str, default: str, ips: list[str], vnets: list[str]) -> dict:
    return {
        "public_network_access_enabled": public,
        "network_acls": [{
            "bypass": bypass,
            "default_action": default,
            "ip_rules": ips,
            "virtual_network_subnet_ids": vnets,
        }],
    }


def workload_fixture() -> tuple[dict, dict]:
    stable = "0000001"
    candidate = "v613-test"
    api = app(
        image=API_IMAGE,
        identities=["/ids/id-bevoac-prod-api"],
        registry_identity="/ids/id-bevoac-prod-api",
        secrets=["pg-password", "admin-api-secret", "pg-api-password", "microsoft-client-secret", "onboarding-state-secret"],
        env=[
            env_value("NODE_ENV", "production"),
            env_value("APP_RUNTIME_MODE", "public_api"),
            env_value("PG_USER", "bevoac_api"),
            env_value("PG_SSL_MODE", "verify-full"),
            env_value("OUTBOX_PUBLISHER_ENABLED", "false"),
            env_value("OUTBOX_IMMEDIATE_PUBLISH_AFTER_REQUEST", "false"),
            env_secret("PG_PASSWORD", "pg-api-password"),
        ],
        ingress=[
            {"revision_suffix": stable, "percentage": 100},
            {"revision_suffix": candidate, "percentage": 0},
        ],
    )
    admin = app(
        image=API_IMAGE,
        identities=["/ids/id-bevoac-prod-admin-api"],
        registry_identity="/ids/id-bevoac-prod-admin-api",
        secrets=["pg-admin-api-password"],
        env=[
            env_value("NODE_ENV", "production"),
            env_value("APP_RUNTIME_MODE", "admin_api"),
            env_value("ADMIN_AUTH_MODE", "oidc"),
            env_value("PG_USER", "bevoac_admin_api"),
            env_value("PG_SSL_MODE", "verify-full"),
            env_secret("PG_PASSWORD", "pg-admin-api-password"),
        ],
        ingress=[],
    )
    admin["ingress"][0]["external_enabled"] = False
    worker = app(
        image=WORKER_IMAGE,
        identities=["/ids/id-bevoac-prod-worker"],
        registry_identity="/ids/id-bevoac-prod-worker",
        secrets=["pg-password", "servicebus-connection-string", "pg-worker-password", "microsoft-client-secret"],
        env=[
            env_value("NODE_ENV", "production"),
            env_value("PG_USER", "bevoac_worker"),
            env_value("PG_SSL_MODE", "verify-full"),
            env_value("SERVICEBUS_AUTH_MODE", "managed_identity"),
            env_secret("PG_PASSWORD", "pg-worker-password"),
        ],
        scale_identity="/ids/id-bevoac-prod-worker",
    )
    outbox = app(
        image=API_IMAGE,
        identities=["/ids/id-bevoac-prod-outbox", "/ids/id-bevoac-prod-api"],
        registry_identity="/ids/id-bevoac-prod-outbox",
        secrets=["pg-password", "pg-outbox-password"],
        env=[
            env_value("NODE_ENV", "production"),
            env_value("APP_RUNTIME_MODE", "outbox"),
            env_value("PG_USER", "bevoac_outbox"),
            env_value("PG_SSL_MODE", "verify-full"),
            env_value("SERVICEBUS_AUTH_MODE", "managed_identity"),
            env_secret("PG_PASSWORD", "pg-outbox-password"),
        ],
    )
    retention = app(
        image=API_IMAGE,
        identities=["/ids/id-bevoac-prod-retention", "/ids/id-bevoac-prod-api"],
        registry_identity="/ids/id-bevoac-prod-retention",
        secrets=["pg-password", "pg-retention-password"],
        env=[
            env_value("NODE_ENV", "production"),
            env_value("APP_RUNTIME_MODE", "retention"),
            env_value("DRY_RUN", "false"),
            env_value("PG_USER", "bevoac_retention"),
            env_value("PG_SSL_MODE", "verify-full"),
            env_secret("PG_PASSWORD", "pg-retention-password"),
        ],
    )
    live_kv = kv(True, "AzureServices", "Allow", ["198.51.100.10/32"], [])
    resources = [
        change("azurerm_container_app.admin_api[0]", ["create"], admin),
        change("azurerm_container_app.api[0]", ["update"], api, {}),
        change("azurerm_container_app.worker[0]", ["update"], worker, {}),
        change("azurerm_container_app.outbox_publisher[0]", ["update"], outbox, {}),
        change("azurerm_container_app_job.retention[0]", ["update"], retention, {}),
        change("azurerm_key_vault.kv", ["no-op"], live_kv, live_kv),
        change("azurerm_postgresql_flexible_server.postgres", ["no-op"], {"public_network_access_enabled": True}, {"public_network_access_enabled": True}),
        change("azurerm_servicebus_namespace.sb", ["no-op"], {"local_auth_enabled": True}, {"local_auth_enabled": True}),
        change("azurerm_key_vault_secret.servicebus_connection_string[0]", ["no-op"], {}, {}),
    ]
    moved = {
        "azurerm_role_assignment.api_kv_reader[0]": "azurerm_role_assignment.api_kv_reader",
        "azurerm_role_assignment.worker_kv_reader[0]": "azurerm_role_assignment.worker_kv_reader",
        "azurerm_role_assignment.api_sb_sender[0]": "azurerm_role_assignment.api_sb_sender",
        "azurerm_role_assignment.api_legacy_admin_secret_reader[0]": "azurerm_role_assignment.api_legacy_admin_secret_reader",
        "azurerm_role_assignment.worker_servicebus_secret_reader[0]": "azurerm_role_assignment.worker_servicebus_secret_reader",
        "time_sleep.wait_for_workload_roles[0]": "time_sleep.wait_for_workload_roles",
    }
    resources.extend(change(address, ["no-op"], {}, {}, previous) for address, previous in moved.items())
    variables = {
        "api_image": API_IMAGE,
        "worker_image": WORKER_IMAGE,
        "outbox_image": API_IMAGE,
        "retention_image": API_IMAGE,
        "admin_api_image": API_IMAGE,
        "api_stable_revision_suffix": stable,
        "api_revision_suffix": candidate,
        "retain_legacy_containerapp_rollback_compatibility": True,
        "retain_legacy_api_admin_secret_reader": True,
        "retain_legacy_servicebus_connection_secret": True,
        "retain_legacy_broad_key_vault_roles": True,
        "retain_legacy_api_servicebus_sender": True,
        "service_bus_local_auth_enabled": True,
        "key_vault_public_network_access_enabled": True,
        "key_vault_network_bypass": "AzureServices",
        "key_vault_network_default_action": "Allow",
        "key_vault_ip_rules": ["198.51.100.10/32"],
        "key_vault_virtual_network_subnet_ids": [],
    }
    return {"resource_changes": resources}, variables


def security_fixture() -> tuple[dict, dict]:
    candidate = "v613-test"
    api = app(
        image=API_IMAGE,
        identities=["/ids/id-bevoac-prod-api"],
        registry_identity="/ids/id-bevoac-prod-api",
        secrets=["pg-api-password", "microsoft-client-secret", "onboarding-state-secret"],
        env=[env_value("APP_RUNTIME_MODE", "public_api"), env_value("PG_USER", "bevoac_api"), env_value("PG_SSL_MODE", "verify-full"), env_secret("PG_PASSWORD", "pg-api-password")],
        ingress=[{"revision_suffix": candidate, "percentage": 100}],
    )
    worker = app(
        image=WORKER_IMAGE,
        identities=["/ids/id-bevoac-prod-worker"],
        registry_identity="/ids/id-bevoac-prod-worker",
        secrets=["pg-worker-password", "microsoft-client-secret"],
        env=[env_value("PG_USER", "bevoac_worker"), env_value("SERVICEBUS_AUTH_MODE", "managed_identity"), env_secret("PG_PASSWORD", "pg-worker-password")],
    )
    outbox = app(
        image=API_IMAGE,
        identities=["/ids/id-bevoac-prod-outbox"],
        registry_identity="/ids/id-bevoac-prod-outbox",
        secrets=["pg-outbox-password"],
        env=[env_value("APP_RUNTIME_MODE", "outbox"), env_value("PG_USER", "bevoac_outbox"), env_value("SERVICEBUS_AUTH_MODE", "managed_identity"), env_secret("PG_PASSWORD", "pg-outbox-password")],
    )
    retention = app(
        image=API_IMAGE,
        identities=["/ids/id-bevoac-prod-retention"],
        registry_identity="/ids/id-bevoac-prod-retention",
        secrets=["pg-retention-password"],
        env=[env_value("APP_RUNTIME_MODE", "retention"), env_value("PG_USER", "bevoac_retention"), env_value("DRY_RUN", "false"), env_secret("PG_PASSWORD", "pg-retention-password")],
    )
    admin = app(
        image=API_IMAGE,
        identities=["/ids/id-bevoac-prod-admin-api"],
        registry_identity="/ids/id-bevoac-prod-admin-api",
        secrets=["pg-admin-api-password"],
        env=[],
        ingress=[],
    )
    admin["ingress"][0]["external_enabled"] = False
    resources = [
        change("azurerm_container_app.api[0]", ["update"], api, {}),
        change("azurerm_container_app.worker[0]", ["update"], worker, {}),
        change("azurerm_container_app.outbox_publisher[0]", ["update"], outbox, {}),
        change("azurerm_container_app_job.retention[0]", ["update"], retention, {}),
        change("azurerm_container_app.admin_api[0]", ["no-op"], admin, admin),
        change("azurerm_key_vault.kv", ["update"], kv(False, "None", "Deny", [], []), {}),
        change("azurerm_postgresql_flexible_server.postgres", ["update"], {"public_network_access_enabled": False}, {}),
        change("azurerm_servicebus_namespace.sb", ["update"], {"local_auth_enabled": False}, {}),
    ]
    required_deletes = {
        "azurerm_key_vault_secret.servicebus_connection_string[0]",
        "azurerm_postgresql_flexible_server_firewall_rule.container_apps_egress[0]",
        "azurerm_role_assignment.api_kv_reader[0]",
        "azurerm_role_assignment.worker_kv_reader[0]",
        "azurerm_role_assignment.api_sb_sender[0]",
        "azurerm_role_assignment.api_legacy_admin_secret_reader[0]",
        "azurerm_role_assignment.worker_servicebus_secret_reader[0]",
        "time_sleep.wait_for_workload_roles[0]",
    }
    resources.extend(change(address, ["delete"], None, {}) for address in required_deletes)
    private = {
        "azurerm_subnet.private_endpoints[0]",
        "azurerm_private_dns_zone.kv[0]",
        "azurerm_private_dns_zone_virtual_network_link.kv[0]",
        "azurerm_private_endpoint.kv[0]",
        "azurerm_private_dns_zone.postgres[0]",
        "azurerm_private_dns_zone_virtual_network_link.postgres[0]",
        "azurerm_private_endpoint.postgres[0]",
    }
    resources.extend(change(address, ["create"], {}, None) for address in private)
    variables = {
        "api_image": API_IMAGE,
        "worker_image": WORKER_IMAGE,
        "outbox_image": API_IMAGE,
        "retention_image": API_IMAGE,
        "admin_api_image": API_IMAGE,
        "api_stable_revision_suffix": candidate,
        "api_revision_suffix": candidate,
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
        "key_vault_ip_rules": [],
        "key_vault_virtual_network_subnet_ids": [],
    }
    return {"resource_changes": resources}, variables


class ValidatorTests(unittest.TestCase):
    def run_validator(self, phase: str, plan: dict, variables: dict) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory() as tmp:
            plan_path = Path(tmp) / "plan.json"
            vars_path = Path(tmp) / "vars.json"
            plan_path.write_text(json.dumps(plan), encoding="utf-8")
            vars_path.write_text(json.dumps(variables), encoding="utf-8")
            return subprocess.run(
                ["python3", str(VALIDATOR), phase, str(plan_path), str(vars_path)],
                text=True,
                capture_output=True,
                check=False,
            )

    def assert_passes(self, phase: str, fixture) -> None:
        plan, variables = fixture()
        result = self.run_validator(phase, plan, variables)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertIn("_RELEASE_PLAN_OK=true", result.stdout)

    def assert_blocks(self, phase: str, plan: dict, variables: dict, text: str) -> None:
        result = self.run_validator(phase, plan, variables)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(text, result.stderr + result.stdout)

    def test_workload_plan_passes(self):
        self.assert_passes("workloads", workload_fixture)

    def test_workload_missing_legacy_secret_blocks(self):
        plan, variables = workload_fixture()
        api_change = next(item for item in plan["resource_changes"] if item["address"] == "azurerm_container_app.api[0]")
        api_change["change"]["after"]["secret"] = [entry for entry in api_change["change"]["after"]["secret"] if entry["name"] != "pg-password"]
        self.assert_blocks("workloads", plan, variables, "public API Container Apps secrets")

    def test_workload_key_vault_acl_drift_blocks(self):
        plan, variables = workload_fixture()
        kv_change = next(item for item in plan["resource_changes"] if item["address"] == "azurerm_key_vault.kv")
        kv_change["change"]["actions"] = ["update"]
        kv_change["change"]["after"] = kv(True, "None", "Allow", [], [])
        self.assert_blocks("workloads", plan, variables, "changed-resource set mismatch")

    def test_workload_mutable_image_blocks(self):
        plan, variables = workload_fixture()
        variables["api_image"] = "acr.example.invalid/bevoac-api-enterprise:v6.1.3"
        self.assert_blocks("workloads", plan, variables, "not digest-pinned")

    def test_workload_unexpected_change_blocks(self):
        plan, variables = workload_fixture()
        plan["resource_changes"].append(change("azurerm_storage_account.frontend", ["update"], {}, {}))
        self.assert_blocks("workloads", plan, variables, "changed-resource set mismatch")

    def test_security_plan_passes(self):
        self.assert_passes("security", security_fixture)

    def test_security_legacy_identity_blocks(self):
        plan, variables = security_fixture()
        outbox_change = next(item for item in plan["resource_changes"] if item["address"] == "azurerm_container_app.outbox_publisher[0]")
        outbox_change["change"]["after"]["identity"][0]["identity_ids"].append("/ids/id-bevoac-prod-api")
        self.assert_blocks("security", plan, variables, "outbox identities mismatch")

    def test_security_missing_required_deletion_blocks(self):
        plan, variables = security_fixture()
        plan["resource_changes"] = [item for item in plan["resource_changes"] if item["address"] != "azurerm_key_vault_secret.servicebus_connection_string[0]"]
        self.assert_blocks("security", plan, variables, "missing Terraform plan entry")

    def test_security_mutable_image_blocks(self):
        plan, variables = security_fixture()
        variables["worker_image"] = "acr.example.invalid/bevoac-worker-enterprise:v6.1.3"
        self.assert_blocks("security", plan, variables, "not digest-pinned")

    def test_security_unapproved_change_blocks(self):
        plan, variables = security_fixture()
        plan["resource_changes"].append(change("azurerm_storage_account.frontend", ["update"], {}, {}))
        self.assert_blocks("security", plan, variables, "unapproved resources")


if __name__ == "__main__":
    unittest.main()
