# TypeSpec spec layout

This folder is the **source of truth** for vaehor API documentation.

## Entry point

- `entry.tsp`: imports all schemas and endpoints and defines the service metadata.

## Structure

- `models/**`: shared models (errors, common responses, domain models, request payloads).
- `modules/**`: feature modules.
  - Each module contains:
    - `models.tsp`
    - `operations.tsp`
    - `index.tsp` (barrel import)
