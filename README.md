# AI Agent Workflow Builder

A full-stack AI Agent Workflow Builder that allows users to create, configure, execute, and monitor multi-step workflows with AI, HTTP, conditional, approval, database, notification, and scheduled trigger capabilities.

## Features

- User authentication with Nhost
- Organization-based workflow isolation
- Role-aware workflow access
- Visual workflow builder
- LLM Call step
- HTTP Request step
- Conditional Branch step
- Human Approval Gate with pause/resume
- Database Write step
- Notification step
- Manual workflow execution
- Scheduled workflow execution using cron
- Workflow run and step-level execution tracking
- Execution status, outputs, and error tracking
- Organization quota tracking
- Real-time workflow execution updates

## Tech Stack

### Frontend
- React
- Vite
- Nhost Auth
- GraphQL / GraphQL WebSocket

### Backend
- Node.js
- Express
- node-cron
- JWT authentication
- Hasura GraphQL API

### Database / Backend Services
- Nhost
- PostgreSQL
- Hasura GraphQL
- Nhost Authentication

## Project Structure

```text
ai-agent-workflow-builder/
├── frontend/
│   ├── src/
│   ├── package.json
│   └── .env
├── backend/
│   ├── src/
│   │   ├── authMiddleware.js
│   │   ├── routes.js
│   │   ├── server.js
│   │   ├── scheduler.js
│   │   ├── supabase.js
│   │   └── workflowExecutor.js
│   ├── package.json
│   └── .env
└── README.md
```

## Prerequisites

- Node.js 18+ recommended
- npm
- A Nhost project with PostgreSQL, Hasura, and Authentication configured
- Git

## Local Setup

Clone the repository:

```bash
git clone https://github.com/RahulNaikMudavath/ai-agent-workflow-builder.git
cd ai-agent-workflow-builder
```

### Backend

```bash
cd backend
npm install
```

Create `backend/.env`:

```env
NHOST_GRAPHQL_URL=your_nhost_graphql_url
NHOST_AUTH_URL=your_nhost_auth_url
NHOST_SUBDOMAIN=your_nhost_subdomain
NHOST_REGION=your_nhost_region
NHOST_ADMIN_SECRET=your_nhost_admin_secret
NHOST_JWT_SECRET=your_nhost_jwt_secret
PORT=5001
```

Start the backend:

```bash
npm run dev
```

The API runs locally at:

```text
http://localhost:5001
```

### Frontend

Open another terminal:

```bash
cd frontend
npm install
```

Create `frontend/.env`:

```env
VITE_API_URL=http://localhost:5001/api
VITE_HASURA_WS_URL=your_hasura_websocket_url
```

Start the frontend:

```bash
npm run dev
```

The Vite development server will normally be available at:

```text
http://localhost:5173
```

## Environment Variables

Environment variables contain credentials and deployment-specific configuration.

Do not commit actual secrets to GitHub.

Use placeholder values in local `.env` files and configure production secrets through the hosting provider's environment-variable settings.

Required backend variables:

```text
NHOST_GRAPHQL_URL
NHOST_AUTH_URL
NHOST_SUBDOMAIN
NHOST_REGION
NHOST_ADMIN_SECRET
NHOST_JWT_SECRET
PORT
```

Required frontend variables:

```text
VITE_API_URL
VITE_HASURA_WS_URL
```

## Running a Workflow

1. Sign in using an Nhost-authenticated account.
2. Create a workflow and provide a workflow name.
3. Add workflow steps from the available step types.
4. Configure each step.
5. Save the workflow.
6. Start the workflow.
7. Monitor step execution and workflow status.
8. If an Approval Gate is reached, the workflow pauses until an authorized user approves it.
9. After approval, execution resumes from the paused position.
10. The workflow completes after all remaining steps finish successfully.

## Supported Workflow Steps

### LLM Call
Uses the configured LLM operation to process a prompt and produce an output.

### HTTP Request
Sends an HTTP request to a configured endpoint and passes the result through the workflow.

### Conditional Branch
Evaluates a configured condition and determines the next workflow path.

### Approval Gate
Pauses execution until an authorized user explicitly approves the workflow step.

### DB Write
Persists workflow output/data to the configured workflow data storage.

### Notify
Creates a workflow notification containing the execution result.

## Scheduled Workflows

Scheduled execution is implemented using `node-cron`.

A scheduled trigger is stored in the `workflow_triggers` table with a cron expression in its JSON configuration.

For example:

```json
{
  "cron": "*/1 * * * *"
}
```

When the scheduler starts, it loads active scheduled triggers and creates cron jobs. The scheduler periodically synchronizes trigger configuration so newly created or changed schedules can be picked up.

Scheduled executions use the same workflow executor as manual executions.

## Production Deployment

### Frontend

The frontend is deployed using Vercel.

Production API configuration:

```text
VITE_API_URL=https://ai-agent-workflow-builder-p1c6.onrender.com/api
```

### Backend

The backend is deployed using Render.

Production backend:

```text
https://ai-agent-workflow-builder-p1c6.onrender.com
```

### Live Application

```text
https://ai-agent-workflow-builder-rho-sage.vercel.app
```

## Security

- Authentication is handled through Nhost.
- Backend endpoints verify authenticated users.
- Organization membership and roles are checked for protected workflow operations.
- Workflow access is validated server-side rather than relying only on frontend restrictions.
- Database/Hasura permissions provide an additional data-access boundary.
- Secrets are stored in environment variables and are not committed to the repository.

## Database

The main application tables include:

```text
organizations
org_members
workflows
workflow_steps
workflow_runs
step_runs
workflow_data
workflow_triggers
```

Workflow definitions and workflow execution history are separated so that reusable workflow configuration can be maintained independently from individual execution records.

## Final Task Scenario

The application supports the complete workflow scenario:

```text
LLM Call
    ↓
Conditional Branch
    ↓
HTTP Request
    ↓
Approval Gate
    ↓
DB Write
    ↓
Notify
```

The Approval Gate pauses the workflow and allows an authorized user to resume execution. The remaining steps then continue and the workflow is marked completed after successful execution.

## API

The backend exposes REST endpoints under:

```text
/api
```

Important workflow operations include:

```text
POST /api/workflows
POST /api/workflows/:id/start
POST /api/workflow-runs/:runId/approve
POST /api/workflows/:id/webhook
```

Additional endpoints are available for workflow runs, execution tracking, and related operations.

## Development Notes

The project is designed as a full-stack workflow execution system. The frontend is responsible for workflow creation and monitoring, while the backend performs authorization, workflow execution, scheduled execution, approval handling, and database operations through the Hasura GraphQL API.

For production deployment, configure all secrets and service URLs through the hosting provider rather than committing them to source control.
