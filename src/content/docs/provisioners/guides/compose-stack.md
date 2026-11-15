---
title: Run provisioners in a Compose stack
description: Provision PostgreSQL and Keycloak before your application starts, using Docker Compose.
---

Each provisioner reads a YAML file, makes its service match it, and exits. In Docker Compose that
means one provisioner service per backing service, and your application waits for all of them to
finish successfully.

This guide combines [postgres-provisioner](/postgres-provisioner/) and
[keycloak-provisioner](/keycloak-provisioner/). Look up the current image tags on the project pages
and use them in place of `<version>` below.

## The stack

```yaml
services:
  postgres-provisioner:
    image: ghcr.io/datarocks-ag/postgres-provisioner:<version>
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      POSTGRES_HOST: postgres
      POSTGRES_USER: admin
      POSTGRES_PASSWORD: adminpass
      PGHELPER_CONFIG_PATH: /config.yaml
    volumes: ["./provision/postgres.yaml:/config.yaml:ro"]

  keycloak-provisioner:
    image: ghcr.io/datarocks-ag/keycloak-provisioner:<version>
    depends_on: [keycloak]
    environment:
      KEYCLOAK_URL: http://keycloak:8080
      KEYCLOAK_USER: admin
      KEYCLOAK_PASSWORD: adminpass
      KEYCLOAK_CONFIG_PATH: /config.yaml
    volumes: ["./provision/keycloak.yaml:/config.yaml:ro"]

  app:
    depends_on:
      postgres-provisioner:
        condition: service_completed_successfully
      keycloak-provisioner:
        condition: service_completed_successfully
```

The `postgres`, `keycloak` and `app` services are your own. The credentials above are placeholders for
a local setup; in production pass secrets through the environment or secret files rather than
writing them into the Compose file.

## How it fits together

1. **Point each provisioner at its service.** `POSTGRES_HOST` and `KEYCLOAK_URL` name the Compose
   service. The Keycloak provisioner also needs `KEYCLOAK_USER` and `KEYCLOAK_PASSWORD`.
2. **Mount a config file.** `PGHELPER_CONFIG_PATH` and `KEYCLOAK_CONFIG_PATH` give the path inside the
   container. Mount it read-only.
3. **Keep secrets out of the files.** Both configs expand `${VAR}` references from the environment, so
   a password in the YAML can come from a variable you pass to the provisioner.
4. **Gate the application.** `service_completed_successfully` starts `app` only after a provisioner
   exited with success, so a failing provisioner stops the stack from coming up half-configured.

## Running it repeatedly

Provisioners are idempotent: run them on every `docker compose up` and existing resources are
reconciled, not recreated. Both support `--dry-run`, which logs what would change without applying it.

For the config fields of each provisioner, see its own documentation, built from its latest release.
