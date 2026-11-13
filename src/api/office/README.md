# STOLDOM OFFICE API

All routes are mounted under `/api/office`.

| Domain | Endpoints | Current state |
|---|---|---|
| organizations | `GET /organizations/lookup/:bin` | **Live KGD open-data proxy**; requires `KGD_API_TOKEN` |
| organizations | `GET/POST /organizations`, `GET /organizations/:id` | Requires PostgreSQL persistence and authentication |
| documents | `GET/POST /documents`, `GET /documents/:id` | Scaffold only |
| reports | `GET /reports`, `GET /reports/calendar` | Scaffold only |
| tasks | `GET/POST /tasks`, `PATCH /tasks/:id` | Scaffold only |
| integrations | `GET /integrations`, `GET /integrations/:provider/status`, `POST /integrations/:provider/connect` | Scaffold only |
| settings | `GET/PUT /settings` | Scaffold only |

## KGD counterparty lookup

The organizations lookup endpoint calls the documented KGD open-data API:

- Upstream: `POST {KGD_PORTAL_HOST}/services/isnaportal/public/get-sur-data`
- Header: `X-Portal-Token: {KGD_API_TOKEN}`
- JSON body: `{"xin":"12-digit-BIN" }`
- STOLDOM endpoint: `GET /api/office/organizations/lookup/:bin`

The token is read only from server-side environment variables. If it is absent, the endpoint returns `503 KGD_TOKEN_MISSING`. The endpoint does not fabricate company records. It returns the KGD response with source and retrieval timestamp.

Configure:
- `KGD_PORTAL_HOST` (currently defaults to `https://portal.kgd.gov.kz`)
- `KGD_API_TOKEN` (request from KGD administrator)

KGD announced a planned portal-domain change from `portal.kgd.gov.kz` to `kgd.gov.kz`, with a preliminary transition date of 17 November 2026. Keep the host configurable and verify the final migration notice before changing production settings.

## Other provider integrations

External adapters should be isolated from business routes, for example:
- `src/integrations/smart-bridge/`
- `src/integrations/banks/`
- `src/integrations/one-c/`

Smart Bridge services require their own service-card review, eligibility/access request, organization authorization and credentials. A BIN alone does not authorize access to protected taxpayer, bank or eGov data. Record provider, retrieval time and source freshness for every imported dataset.
