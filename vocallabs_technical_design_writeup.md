# VocalLabs AI Agent Workflow Builder — Technical Design Write-up

## Schema Reasoning

The database schema is designed around organizations, users, workflows, workflow steps, executions, and actions so that every piece of workflow data can be traced back to the organization that owns it. The organization is the primary isolation boundary. Users belong to an organization, while workflows and their related execution data are associated with that organization as well.

A workflow contains ordered steps, and each step represents an individual action that can be executed as part of the workflow. Workflow executions are stored separately from workflow definitions so that the system can maintain execution state, failures, retries, and approval-gate pauses without modifying the original workflow configuration.

This separation also makes it possible to track an execution independently from the workflow itself. For example, an execution can move through states such as `running`, `waiting_for_approval`, `completed`, or `failed`, while the workflow definition remains unchanged.

The relationships are structured so that Hasura can expose the required nested relationships cleanly, such as Organization → Workflows → Steps and Workflow → Executions. Organization ownership is also checked when accessing resources, preventing a user from accessing another organization's data even if they know or guess a resource ID.

## Two Permission Layers

The application uses two different permission layers because authentication/organization access and action-level authorization solve different security problems.

The first layer is organization/resource-level authorization. After authenticating the user, the backend determines the user's organization and verifies that the requested workflow, execution, or other resource belongs to that organization. This prevents cross-organization access and protects against direct ID guessing. The check is performed on the server rather than relying on the frontend to hide resources.

The second layer is step-level permission gating. Even when a user is allowed to access a workflow, that does not automatically mean they are allowed to execute every action inside it. The Action handler performs the permission check immediately before executing an individual step. It verifies the user's permission for that specific action and rejects the operation when the required permission is missing.

Therefore, the two checks provide different protections:

`Organization/resource authorization → Can this user access this resource?`

`Action permission → Can this user execute this specific step?`

The second check is enforced inside the Action handler itself, so directly calling the backend API cannot bypass the permission restriction.

## Approval-Gate Pause and Resume

The approval gate is implemented as a workflow execution state rather than simply a frontend confirmation dialog. When execution reaches an approval-required step, the Action handler does not continue to the next step. Instead, it records the execution as `waiting_for_approval` and persists the current execution/step state.

This allows the workflow to safely pause even if the user closes the browser or the frontend is refreshed. The pending approval can then be displayed to an authorized user.

When the authorized user approves the pending action, the backend updates the approval state and resumes the same workflow execution from the paused step. The workflow does not start from the beginning; it continues from the stored execution state and proceeds to the next step.

If the approval is rejected, the execution is transitioned to the appropriate failure/cancelled state instead of continuing.

This design keeps workflow state on the backend, makes the approval gate durable, and ensures that authorization is checked again when the approval/resume operation is performed rather than trusting the frontend.
