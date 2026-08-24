# Security classification — DEMO ONLY

## Scope

The frontend is excluded from the contractual production API perimeter in Bevoac V6.2.0.

## Enforced behavior

- synthetic data only;
- no customer credentials;
- no browser storage of API keys;
- no generic API proxy;
- `/api/bevoac` returns HTTP 410;
- no scan execution control;
- visible demonstration banner.

## Production prohibition

Do not use this package to authenticate customers, store API keys, display live tenant data, or control production scans.
