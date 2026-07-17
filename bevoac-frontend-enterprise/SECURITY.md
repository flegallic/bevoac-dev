# Security notes

## Tenant isolation

This frontend does not maintain a shared backend session store. Each customer key is submitted by the browser to `/api/bevoac` for the current request and used immediately against the approved Bevoac APIM endpoint.

## Secret handling

Customer `BEVOAC_API_KEY` values must not be committed, logged, embedded in images, stored in Terraform state or configured as shared Container App secrets.

For the highest assurance mode, use in-memory browser state only. The current implementation uses browser `sessionStorage` so refresh keeps the active session; disconnect clears it.

## Proxy restrictions

`BEVOAC_ALLOWED_API_HOSTS` must contain only trusted Bevoac APIM hosts. This prevents the frontend proxy from being abused as a generic HTTPS proxy.

## Production recommendations

- Add Azure Front Door or Application Gateway WAF in front of the Container App.
- Enforce HTTPS only.
- Add rate limiting at APIM and WAF.
- Enable Azure Container Apps diagnostics.
- Send audit logs to Log Analytics.
- Use GitHub OIDC for CI/CD.
- Keep customer API keys out of Terraform state.
