# AI Agent Workflow Builder — Schema, Authorization & Approval Design

## 1. Schema reasoning

The application separates workflow definitions from workflow execution state so that a workflow can be reused while every execution remains independently traceable.

The main entities are:

- `organizations` — tenant boundary for the application.
- `org_members` — maps authenticated users to organizations and stores their role.
- `workflows` — stores the workflow definition and belongs to an organization.
- `workflow_steps` — stores the ordered steps belonging to a workflow. Step-specific settings are stored in `config` as JSONB so different step types can have different configuration without requiring a new column for every step type.
- `workflow_runs` — represents one execution of a workflow.
- `step_runs` — records the execution of individual workflow steps, including status, input, output, errors, and attempt count.
- `workflow_data` — stores data produced or persisted during workflow execution.
- `workflow_triggers` — stores trigger definitions such as scheduled cron expressions.

This separation keeps configuration, execution history, and trigger configuration independent. It also makes execution auditable because a workflow run can be inspected step by step through its related `step_runs`.

The workflow hierarchy is conceptually:

`organization → workflows → workflow_steps`

and execution is:

`workflow → workflow_runs → step_runs`

while scheduled execution is:

`workflow → workflow_triggers`.

## 2. Two permission layers

Authorization is implemented as defense in depth rather than relying on the frontend.

The first layer is the Hasura data-access permission layer. The database/Hasura model associates workflows with an organization and users with organizations through `org_members`. Hasura permissions can therefore restrict which rows an authenticated role can access based on the user's organization membership and role. This protects the GraphQL/data layer even when a client attempts to request a resource directly by UUID.

The second layer is the backend/action authorization layer. Protected backend routes authenticate the request using the user's JWT, resolve the authenticated user ID, obtain the user's organization membership, and check the required role before sensitive workflow operations. Workflow access is checked against the workflow's organization instead of trusting an ID supplied by the client.

This gives two independent enforcement points: Hasura controls data visibility/access at the GraphQL layer, while the backend controls whether a particular operation such as starting, modifying, or approving a workflow is allowed. The frontend is therefore not treated as a security boundary.

## 3. Approval-gate pause/resume

The workflow executor processes steps in position order. When it reaches an `approval_gate`, execution does not continue to the following step.

The current workflow run is persisted as paused/waiting for approval, and the execution position is retained. The frontend can observe the paused run and present the approval action to an authorized user.

Approval is handled by a protected backend endpoint. The approval handler verifies authentication, checks workflow/run access and the user's role, marks the approval step as approved, changes the workflow run back to a running state, and resumes execution from the stored position.

The workflow therefore does not restart from step one after approval. It continues with the remaining steps, allowing the final task to proceed from:

`Approval Gate → DB Write → Notify`.

## 4. Retry and failure tracking

Each step execution is represented by a `step_runs` record. The record contains the execution status, input, output, error information, and attempt count.

The executor's callbacks create/update step-run records as execution starts and completes. If an operation fails, the error is persisted rather than silently treating the step as successful. Workflow-run status is updated based on the executor result.

This provides an execution history that can be inspected independently from the workflow definition.

## 5. Quota enforcement

Workflow usage is associated with the organization. Before execution, the backend checks the organization's configured quota information. Successful workflow completion increments the organization's usage counter.

Keeping quota information at the organization level ensures that usage is shared consistently across members of the same tenant rather than being tracked only in the browser or per user.

## 6. Scheduled execution

Scheduled triggers are stored in `workflow_triggers`. A scheduled trigger contains its cron expression in the JSON configuration.

The backend scheduler uses `node-cron` to synchronize stored scheduled triggers and create the corresponding cron jobs. When a cron job fires, the scheduler creates a `workflow_run` and passes the workflow to the same workflow executor used for manual execution.

This keeps manual and scheduled workflows on a common execution path and ensures that step tracking, approval behavior, output handling, and quota logic remain consistent.
