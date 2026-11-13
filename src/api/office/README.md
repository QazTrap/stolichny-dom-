# STOLDOM OFFICE API

All routes are mounted under `/api/office`.

| Domain | Endpoints | Future responsibility |
|---|---|---|
| organizations | GET/POST /organizations, GET /organizations/:id | Company profiles, BIN, contacts, accountant assignments |
| documents | GET/POST /documents, GET /documents/:id | ESF, EAVR, contracts, acts, bank statements, 1C files |
| reports | GET /reports, GET /reports/calendar | Tax forms, deadlines, reporting status |
| tasks | GET/POST /tasks, PATCH /tasks/:id | Team tasks, assignees, priorities, due dates |
| integrations | GET /integrations, GET /integrations/:provider/status, POST /integrations/:provider/connect | Provider connection status and authorization workflows |
| settings | GET/PUT /settings | Roles, permissions, workspace preferences |

The route modules intentionally return HTTP 501 with `MODULE_NOT_CONFIGURED` until persistence, authorization and domain logic are implemented. No demo company or tax data is fabricated.

## Planned provider adapters

External adapters should be isolated from business routes, for example:
- `src/integrations/kgd/`
- `src/integrations/smart-bridge/`
- `src/integrations/banks/`
- `src/integrations/one-c/`

Secrets must remain in server-side environment variables. A BIN alone must never be treated as authorization to access protected taxpayer, banking or eGov data. Record provider, retrieval time and source freshness for every imported dataset.
