const express = require("express");
const { graphqlRequest } = require("./supabase");
const { executeWorkflow } = require("./workflowExecutor");
const { requireAuth } = require("./authMiddleware");

const router = express.Router();


// ========================================
// AUTH / ORGANIZATION SECURITY HELPERS
// ========================================


function getHasuraUserId(req) {
  return (
    req.user?.id ||
    req.headers["x-hasura-user-id"] ||
    req.headers["X-Hasura-User-Id"]
  );
}


async function getOrgMember(orgId, userId) {
  if (!orgId || !userId) {
    return null;
  }


  const query = `
    query GetOrgMember(
      $org_id: uuid!
      $user_id: uuid!
    ) {
      org_members(
        where: {
          org_id: { _eq: $org_id }
          user_id: { _eq: $user_id }
        }
        limit: 1
      ) {
        id
        org_id
        user_id
        role
      }
    }
  `;


  const data = await graphqlRequest(query, {
    org_id: orgId,
    user_id: userId,
  });


  return data.org_members?.[0] || null;
}


function canTriggerWorkflow(role) {
  return role === "owner" || role === "editor";
}


function canManageWorkflow(role) {
  return role === "owner" || role === "editor";
}


function isOwner(role) {
  return role === "owner";
}


async function requireWorkflowAccess(req, workflow, options = {}) {
  const userId = getHasuraUserId(req);


  if (!userId) {
    const error = new Error("Authentication required");
    error.statusCode = 401;
    throw error;
  }


  const member = await getOrgMember(workflow.org_id, userId);


  if (!member) {
    const error = new Error(
      "You are not a member of this organization"
    );
    error.statusCode = 403;
    throw error;
  }


  const requiredRole = options.requiredRole;


  if (requiredRole === "owner" && member.role !== "owner") {
    const error = new Error(
      "Owner permission required"
    );
    error.statusCode = 403;
    throw error;
  }


  if (
    requiredRole === "owner_or_editor" &&
    !["owner", "editor"].includes(member.role)
  ) {
    const error = new Error(
      "Owner or editor permission required"
    );
    error.statusCode = 403;
    throw error;
  }


  return {
    userId,
    member,
  };
}


// Health check
router.get("/health", (req, res) => {
  res.json({
    status: "ok",
  });
});

// Get all workflows
router.get("/workflows", async (req, res) => {
  try {
    const query = `
      query GetWorkflows {
        workflows(order_by: { created_at: desc }) {
          id
          name
          description
          org_id
          created_at
        }
      }
    `;

    const data = await graphqlRequest(query);

    res.json(data.workflows);
  } catch (error) {
    console.error("Get workflows error:", error);

    res.status(500).json({
      error: error.message,
    });
  }
});

// Get one workflow with its steps
router.get("/workflows/:id", async (req, res) => {
  try {
    const query = `
      query GetWorkflow($id: uuid!) {
        workflows_by_pk(id: $id) {
          id
          name
          description
          org_id
          created_at

          workflow_steps(order_by: { position: asc }) {
            id
            workflow_id
            position
            type
            config
          }
        }
      }
    `;

    const data = await graphqlRequest(query, {
      id: req.params.id,
    });

    if (!data.workflows_by_pk) {
      return res.status(404).json({
        error: "Workflow not found",
      });
    }

    res.json(data.workflows_by_pk);
  } catch (error) {
    console.error("Get workflow error:", error);

    res.status(500).json({
      error: error.message,
    });
  }
});

// Create workflow
router.post("/workflows", requireAuth, async (req, res) => {
  try {
    const {
      name,
      description,
      steps = [],
      org_id,
    } = req.body || {};


    console.log("CREATE WORKFLOW BODY:", req.body);


    if (!name || !name.trim()) {
      return res.status(400).json({
        error: "Workflow name is required",
      });
    }


    if (!org_id) {
      return res.status(400).json({
        error: "Organization ID is required",
      });
    }

    // Create workflow
    const workflowMutation = `
      mutation CreateWorkflow(
        $name: String!
        $description: String
        $org_id: uuid!
      ) {
        insert_workflows_one(
          object: {
            name: $name
            description: $description
            org_id: $org_id
          }
        ) {
          id
          name
          description
          org_id
          created_at
        }
      }
    `;

    const workflowData = await graphqlRequest(workflowMutation, {
      name: name.trim(),
      description: description || null,
      org_id,
    });

    const workflow = workflowData.insert_workflows_one;

    if (!workflow) {
      return res.status(500).json({
        error: "Failed to create workflow",
      });
    }

    // Create workflow steps
    let createdSteps = [];

    if (steps.length > 0) {
      const stepRows = steps.map((step, index) => ({
        workflow_id: workflow.id,
        position: step.position || index + 1,
        type: step.type,
        config: step.config || {},
      }));

      const stepsMutation = `
        mutation CreateWorkflowSteps(
          $objects: [workflow_steps_insert_input!]!
        ) {
          insert_workflow_steps(
            objects: $objects
          ) {
            returning {
              id
              workflow_id
              position
              type
              config
            }
          }
        }
      `;

      const stepsData = await graphqlRequest(stepsMutation, {
        objects: stepRows,
      });

      createdSteps =
        stepsData.insert_workflow_steps.returning;
    }

    res.status(201).json({
      ...workflow,
      steps: createdSteps,
    });
  } catch (error) {
    console.error("Create workflow error:", error);

    res.status(500).json({
      error: error.message,
    });
  }
});

// Creates the run first so the frontend can subscribe immediately
router.post("/workflows/:id/start", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const query = `
      query GetWorkflow($id: uuid!) {
        workflows_by_pk(id: $id) {
          id
          name
          description
          org_id
          created_at

          workflow_steps(order_by: { position: asc }) {
            id
            workflow_id
            position
            type
            config
          }
        }
      }
    `;

    const data = await graphqlRequest(query, { id });

    if (!data.workflows_by_pk) {
      return res.status(404).json({
        error: "Workflow not found",
      });
    }

    const workflow = data.workflows_by_pk;
    const steps = workflow.workflow_steps;

    // ========================================
    // ORGANIZATION + ROLE CHECK
    // ========================================
    const { userId, member } = await requireWorkflowAccess(
      req,
      workflow,
      {
        requiredRole: "owner_or_editor",
      }
    );

    console.log(
      `Workflow ${workflow.id} start triggered by ${userId} (${member.role})`
    );

    // ========================================
    // QUOTA CHECK
    // ========================================
    const quotaQuery = `
      query GetOrganizationQuota($id: uuid!) {
        organizations_by_pk(id: $id) {
          id
          calls_used
          calls_allowed
          quota_period_start
        }
      }
    `;

    const quotaData = await graphqlRequest(quotaQuery, {
      id: workflow.org_id,
    });

    const organization = quotaData.organizations_by_pk;

    if (!organization) {
      return res.status(404).json({
        error: "Organization not found",
      });
    }

    if (
      organization.calls_used >=
      organization.calls_allowed
    ) {
      return res.status(429).json({
        error: "Organization usage quota exhausted",
      });
    }

    // Create workflow run in database first
    const createRunMutation = `
      mutation CreateWorkflowRun(
        $workflow_id: uuid!
        $status: String!
      ) {
        insert_workflow_runs_one(
          object: {
            workflow_id: $workflow_id
            status: $status
          }
        ) {
          id
        }
      }
    `;

    const runData = await graphqlRequest(createRunMutation, {
      workflow_id: id,
      status: "running",
    });

    const workflowRun = runData.insert_workflow_runs_one;

    // Return the response immediately so frontend can subscribe
    res.status(201).json({
      success: true,
      workflow_id: id,
      workflow_run_id: workflowRun.id,
      status: "running",
    });

    // Run execution in the background
    setImmediate(async () => {
      try {
        const result = await executeWorkflow(
          {
            ...workflow,
            steps,
            input: req.body?.input || null,
          },
          {
            workflowRunId: workflowRun.id,
            onStepStart: async ({ step, input }) => {
              const mutation = `
                mutation CreateRunningStepRun(
                  $workflow_run_id: uuid!
                  $workflow_step_id: uuid!
                  $status: String!
                  $input: jsonb
                  $attempt_count: Int!
                ) {
                  insert_step_runs_one(
                    object: {
                      workflow_run_id: $workflow_run_id
                      workflow_step_id: $workflow_step_id
                      status: $status
                      input: $input
                      attempt_count: $attempt_count
                    }
                  ) {
                    id
                  }
                }
              `;

              await graphqlRequest(mutation, {
                workflow_run_id: workflowRun.id,
                workflow_step_id: step.id,
                status: "running",
                input: input ?? null,
                attempt_count: 1,
              });
            },
            onStepComplete: async ({
              step,
              result,
              status,
              error,
            }) => {
              const mutation = `
                mutation UpdateStepRun(
                  $workflow_run_id: uuid!
                  $workflow_step_id: uuid!
                  $status: String!
                  $output: jsonb
                  $error: String
                ) {
                  update_step_runs(
                    where: {
                      workflow_run_id: { _eq: $workflow_run_id }
                      workflow_step_id: { _eq: $workflow_step_id }
                      status: { _eq: "running" }
                    }
                    _set: {
                      status: $status
                      output: $output
                      error: $error
                    }
                  ) {
                    affected_rows
                  }
                }
              `;

              await graphqlRequest(mutation, {
                workflow_run_id: workflowRun.id,
                workflow_step_id: step.id,
                status,
                output: result ?? null,
                error: error || null,
              });
            },
          }
        );

        // Update final workflow run status
        const finalStatus =
          result.status === "waiting_for_approval"
            ? "paused"
            : result.status;

        const updateRunMutation = `
          mutation UpdateWorkflowRun(
            $id: uuid!
            $status: String!
            $completed_at: timestamptz
          ) {
            update_workflow_runs_by_pk(
              pk_columns: { id: $id }
              _set: {
                status: $status
                completed_at: $completed_at
              }
            ) {
              id
              workflow_id
              status
              started_at
              completed_at
            }
          }
        `;

        await graphqlRequest(updateRunMutation, {
          id: workflowRun.id,
          status: finalStatus,
          completed_at:
            finalStatus === "running"
              ? null
              : new Date().toISOString(),
        });

        // Increment quota only when completed
        if (result.status === "completed") {
          const incrementQuotaMutation = `
            mutation IncrementQuota($id: uuid!) {
              update_organizations_by_pk(
                pk_columns: { id: $id }
                _inc: {
                  calls_used: 1
                }
              ) {
                id
                calls_used
                calls_allowed
              }
            }
          `;

          await graphqlRequest(incrementQuotaMutation, {
            id: workflow.org_id,
          });
        }

        console.log(
          `Workflow run ${workflowRun.id} finished with status: ${finalStatus}`
        );
      } catch (error) {
        console.error(
          `Background workflow execution failed for ${workflowRun.id}:`,
          error
        );

        // Make sure the run is marked failed
        const updateFailedRunMutation = `
          mutation UpdateFailedWorkflowRun(
            $id: uuid!
            $status: String!
            $completed_at: timestamptz
          ) {
            update_workflow_runs_by_pk(
              pk_columns: { id: $id }
              _set: {
                status: $status
                completed_at: $completed_at
              }
            ) {
              id
              status
              completed_at
            }
          }
        `;

        await graphqlRequest(updateFailedRunMutation, {
          id: workflowRun.id,
          status: "failed",
          completed_at: new Date().toISOString(),
        });
      }
    });
  } catch (error) {
    console.error("Start workflow error:", error);

    const statusCode = error.statusCode || 500;

    res.status(statusCode).json({
      success: false,
      error: error.message,
    });
  }
});

// Run workflow
router.post("/workflows/:id/run", async (req, res) => {
  try {
    const { id } = req.params;

    const query = `
      query GetWorkflow($id: uuid!) {
        workflows_by_pk(id: $id) {
          id
          name
          description
          org_id
          created_at

          workflow_steps(order_by: { position: asc }) {
            id
            workflow_id
            position
            type
            config
          }
        }
      }
    `;

    const data = await graphqlRequest(query, { id });

    if (!data.workflows_by_pk) {
      return res.status(404).json({
        error: "Workflow not found",
      });
    }

    const workflow = data.workflows_by_pk;
    const steps = workflow.workflow_steps;

    // ========================================
    // ORGANIZATION + ROLE CHECK
    // ========================================


    const { userId, member } = await requireWorkflowAccess(
      req,
      workflow,
      {
        requiredRole: "owner_or_editor",
      }
    );


    console.log(
      `Workflow ${workflow.id} triggered by ${userId} (${member.role})`
    );

    // ========================================
    // QUOTA CHECK
    // ========================================


    const quotaQuery = `
      query GetOrganizationQuota($id: uuid!) {
        organizations_by_pk(id: $id) {
          id
          calls_used
          calls_allowed
          quota_period_start
        }
      }
    `;


    const quotaData = await graphqlRequest(quotaQuery, {
      id: workflow.org_id,
    });


    const organization = quotaData.organizations_by_pk;


    if (!organization) {
      return res.status(404).json({
        error: "Organization not found",
      });
    }


    if (
      organization.calls_used >=
      organization.calls_allowed
    ) {
      return res.status(429).json({
        error: "Organization usage quota exhausted",
      });
    }

    // Create workflow run in database
    const createRunMutation = `
      mutation CreateWorkflowRun(
        $workflow_id: uuid!
        $status: String!
      ) {
        insert_workflow_runs_one(
          object: {
            workflow_id: $workflow_id
            status: $status
          }
        ) {
          id
        }
      }
    `;

    const runData = await graphqlRequest(createRunMutation, {
      workflow_id: id,
      status: "running",
    });
    const workflowRun = runData.insert_workflow_runs_one;

    const result = await executeWorkflow(
      {
        ...workflow,
        steps,
        input: req.body?.input || null,
      },
      {
        workflowRunId: workflowRun.id,
        onStepStart: async ({ step, input }) => {
          const mutation = `
            mutation CreateRunningStepRun(
              $workflow_run_id: uuid!
              $workflow_step_id: uuid!
              $status: String!
              $input: jsonb
              $attempt_count: Int!
            ) {
              insert_step_runs_one(
                object: {
                  workflow_run_id: $workflow_run_id
                  workflow_step_id: $workflow_step_id
                  status: $status
                  input: $input
                  attempt_count: $attempt_count
                }
              ) {
                id
                workflow_run_id
                workflow_step_id
                status
                input
                attempt_count
              }
            }
          `;

          await graphqlRequest(mutation, {
            workflow_run_id: workflowRun.id,
            workflow_step_id: step.id,
            status: "running",
            input: input ?? null,
            attempt_count: 1,
          });
        },

        // ========================================
        // STEP COMPLETE
        // ========================================

        onStepComplete: async ({
          step,
          result,
          status,
          error,
          completedAt,
        }) => {
          const mutation = `
            mutation UpdateStepRun(
              $workflow_run_id: uuid!
              $workflow_step_id: uuid!
              $status: String!
              $output: jsonb
              $error: String
            ) {
              update_step_runs(
                where: {
                  workflow_run_id: { _eq: $workflow_run_id }
                  workflow_step_id: { _eq: $workflow_step_id }
                  status: { _eq: "running" }
                }
                _set: {
                  status: $status
                  output: $output
                  error: $error
                }
              ) {
                returning {
                  id
                  workflow_run_id
                  workflow_step_id
                  status
                  input
                  output
                  error
                  attempt_count
                }
              }
            }
          `;

          await graphqlRequest(mutation, {
            workflow_run_id: workflowRun.id,
            workflow_step_id: step.id,
            status,
            output: result ?? null,
            error: error || null,
          });
        },
      }
    );


    // ---------------------------------
    // Update workflow run status
    // ---------------------------------


    const finalStatus =
      result.status === "waiting_for_approval"
        ? "paused"
        : result.status;


    const updateRunMutation = `
      mutation UpdateWorkflowRun(
        $id: uuid!
        $status: String!
        $completed_at: timestamptz
      ) {
        update_workflow_runs_by_pk(
          pk_columns: { id: $id }
          _set: {
            status: $status
            completed_at: $completed_at
          }
        ) {
          id
          workflow_id
          status
          started_at
          completed_at
        }
      }
    `;


    const updatedRun = await graphqlRequest(updateRunMutation, {
      id: workflowRun.id,
      status: finalStatus,
      completed_at:
        finalStatus === "running"
          ? null
          : new Date().toISOString(),
    });


    // ========================================
    // INCREMENT ORGANIZATION USAGE
    // ========================================


    if (result.status === "completed") {
      const incrementQuotaMutation = `
        mutation IncrementQuota($id: uuid!) {
          update_organizations_by_pk(
            pk_columns: { id: $id }
            _inc: {
              calls_used: 1
            }
          ) {
            id
            calls_used
            calls_allowed
          }
        }
      `;


      await graphqlRequest(incrementQuotaMutation, {
        id: workflow.org_id,
      });
    }


    res.json({
      success: true,
      workflow_id: id,
      workflow_run_id: workflowRun.id,
      status: finalStatus,
      output: result.output || null,
      executionLog: result.executionLog || [],
      workflowRun: updatedRun.update_workflow_runs_by_pk,
    });
  } catch (error) {
    console.error("Workflow execution error:", error);


    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Webhook trigger
router.post("/workflows/:id/webhook", async (req, res) => {
  try {
    const { id } = req.params;


    const query = `
      query GetWorkflow($id: uuid!) {
        workflows_by_pk(id: $id) {
          id
          name
          description
          org_id
          created_at
          workflow_steps(order_by: { position: asc }) {
            id
            position
            type
            config
          }
        }
      }
    `;


    const data = await graphqlRequest(query, { id });
    const workflow = data.workflows_by_pk;


    if (!workflow) {
      return res.status(404).json({
        error: "Workflow not found",
      });
    }


    // ========================================
    // QUOTA CHECK
    // ========================================


    const quotaQuery = `
      query GetQuota($id: uuid!) {
        organizations_by_pk(id: $id) {
          id
          calls_used
          calls_allowed
        }
      }
    `;


    const quotaData = await graphqlRequest(quotaQuery, {
      id: workflow.org_id,
    });


    const organization = quotaData.organizations_by_pk;


    if (!organization) {
      return res.status(404).json({
        error: "Organization not found",
      });
    }


    if (
      organization.calls_used >=
      organization.calls_allowed
    ) {
      return res.status(429).json({
        error: "Organization usage quota exhausted",
      });
    }


    // Create workflow run in database
    const createRunMutation = `
      mutation CreateWorkflowRun(
        $workflow_id: uuid!
        $status: String!
      ) {
        insert_workflow_runs_one(
          object: {
            workflow_id: $workflow_id
            status: $status
          }
        ) {
          id
        }
      }
    `;


    const runData = await graphqlRequest(createRunMutation, {
      workflow_id: id,
      status: "running",
    });
    const workflowRun = runData.insert_workflow_runs_one;


    // Return run details immediately
    res.json({
      success: true,
      workflow_id: id,
      workflow_run_id: workflowRun.id,
      status: "running",
    });


    // Execute the workflow in the background
    setImmediate(async () => {
      try {
        const result = await executeWorkflow(
          {
            ...workflow,
            steps: workflow.workflow_steps,
            input: req.body || null,
          },
          {
            workflowRunId: workflowRun.id,
            onStepStart: async ({ step, input }) => {
              const mutation = `
                mutation CreateRunningStepRun(
                  $workflow_run_id: uuid!
                  $workflow_step_id: uuid!
                  $status: String!
                  $input: jsonb
                  $attempt_count: Int!
                ) {
                  insert_step_runs_one(
                    object: {
                      workflow_run_id: $workflow_run_id
                      workflow_step_id: $workflow_step_id
                      status: $status
                      input: $input
                      attempt_count: $attempt_count
                    }
                  ) {
                    id
                  }
                }
              `;


              await graphqlRequest(mutation, {
                workflow_run_id: workflowRun.id,
                workflow_step_id: step.id,
                status: "running",
                input: input ?? null,
                attempt_count: 1,
              });
            },
            onStepComplete: async ({
              step,
              result,
              status,
              error,
            }) => {
              const mutation = `
                mutation UpdateStepRun(
                  $workflow_run_id: uuid!
                  $workflow_step_id: uuid!
                  $status: String!
                  $output: jsonb
                  $error: String
                ) {
                  update_step_runs(
                    where: {
                      workflow_run_id: { _eq: $workflow_run_id }
                      workflow_step_id: { _eq: $workflow_step_id }
                      status: { _eq: "running" }
                    }
                    _set: {
                      status: $status
                      output: $output
                      error: $error
                    }
                  ) {
                    returning {
                      id
                    }
                  }
                }
              `;


              await graphqlRequest(mutation, {
                workflow_run_id: workflowRun.id,
                workflow_step_id: step.id,
                status,
                output: result ?? null,
                error: error || null,
              });
            },
          }
        );


        const finalStatus =
          result.status === "waiting_for_approval"
            ? "paused"
            : result.status;


        const updateRunMutation = `
          mutation UpdateWorkflowRun(
            $id: uuid!
            $status: String!
          ) {
            update_workflow_runs_by_pk(
              pk_columns: { id: $id }
              _set: { status: $status }
            ) {
              id
              status
            }
          }
        `;


        await graphqlRequest(updateRunMutation, {
          id: workflowRun.id,
          status: finalStatus,
        });


        if (finalStatus === "completed") {
          const incrementQuotaMutation = `
            mutation IncrementQuota($id: uuid!) {
              update_organizations_by_pk(
                pk_columns: { id: $id }
                _inc: {
                  calls_used: 1
                }
              ) {
                id
                calls_used
                calls_allowed
              }
            }
          `;


          await graphqlRequest(incrementQuotaMutation, {
            id: workflow.org_id,
          });
        }


        console.log(
          `Webhook workflow run ${workflowRun.id} finished with status: ${finalStatus}`
        );


      } catch (error) {
        console.error("Webhook workflow execution error:", error);


        try {
          await graphqlRequest(
            `
              mutation FailWorkflowRun(
                $id: uuid!
                $status: String!
              ) {
                update_workflow_runs_by_pk(
                  pk_columns: { id: $id }
                  _set: { status: $status }
                ) {
                  id
                  status
                }
              }
            `,
            {
              id: workflowRun.id,
              status: "failed",
            }
          );
        } catch (updateError) {
          console.error(
            "Failed to update webhook run:",
            updateError
          );
        }
      }
    });


  } catch (error) {
    console.error("Webhook trigger error:", error);


    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Approve paused workflow and resume execution
router.post(
  "/workflow-runs/:runId/approve",
  requireAuth,
  async (req, res) => {
  try {
    const { runId } = req.params;

    const runQuery = `
      query GetRun($runId: uuid!) {
        workflow_runs_by_pk(id: $runId) {
          id
          workflow_id
          status
        }
      }
    `;
    const runData = await graphqlRequest(runQuery, { runId });
    if (!runData.workflow_runs_by_pk) {
      return res.status(404).json({ error: "Workflow run not found" });
    }
    const workflowId = runData.workflow_runs_by_pk.workflow_id;

    // Fetch workflow steps
    const workflowQuery = `
      query GetWorkflow($id: uuid!) {
        workflows_by_pk(id: $id) {
          id
          name
          description
          org_id
          created_at

          workflow_steps(order_by: { position: asc }) {
            id
            position
            type
            config
          }
        }
      }
    `;
    const workflowData = await graphqlRequest(workflowQuery, { id: workflowId });
    const workflow = workflowData.workflows_by_pk;
    const steps = workflow.workflow_steps;

    // ========================================
    // APPROVER SECURITY CHECK
    // ========================================


    const { userId, member } = await requireWorkflowAccess(
      req,
      workflow,
      {
        requiredRole: "owner_or_editor",
      }
    );


    console.log(
      `Approval requested by ${userId} (${member.role})`
    );

    // Fetch existing step runs to determine start position and last output
    const stepRunsQuery = `
      query GetStepRuns($runId: uuid!) {
        step_runs(
          where: { workflow_run_id: { _eq: $runId } }
        ) {
          id
          status
          output
          workflow_step_id
        }
      }
    `;
    const stepRunsData = await graphqlRequest(stepRunsQuery, { runId });
    const stepRuns = stepRunsData.step_runs;

    // Find the approval-gate step that paused this run
    const pausedStepRun = stepRuns.find(
      (run) => run.status === "paused"
    );


    const pausedStep = pausedStepRun
      ? steps.find(
          (step) => step.id === pausedStepRun.workflow_step_id
        )
      : null;


    if (!pausedStep) {
      return res.status(400).json({
        success: false,
        error: "No paused approval gate found for this workflow run",
      });
    }

    const approveStepMutation = `
      mutation ApproveStepRun(
        $id: uuid!
        $approved_by: uuid!
        $approved_at: timestamptz!
      ) {
        update_step_runs_by_pk(
          pk_columns: { id: $id }
          _set: {
            status: "completed"
            approved_by: $approved_by
            approved_at: $approved_at
          }
        ) {
          id
          status
          approved_by
          approved_at
        }
      }
    `;

    await graphqlRequest(approveStepMutation, {
      id: pausedStepRun.id,
      approved_by: userId,
      approved_at: new Date().toISOString(),
    });


    console.log("✅ STEP RUN APPROVED:", pausedStepRun.id);


    // Resume from the step AFTER the approval gate
    const startPosition = pausedStep.position + 1;


    // Use the approval gate's output as the next step's input
    const initialInput =
      pausedStepRun.output?.data !== undefined
        ? pausedStepRun.output.data
        : pausedStepRun.output;


    const initialOutput = initialInput;

    // Update workflow run status to running
    const updateToRunningMutation = `
      mutation UpdateToRunning($id: uuid!) {
        update_workflow_runs_by_pk(
          pk_columns: { id: $id }
          _set: { status: "running" }
        ) {
          id
        }
      }
    `;
    await graphqlRequest(updateToRunningMutation, { id: runId });


    console.log("✅ WORKFLOW RUN SET TO RUNNING:", runId);

    console.log("🚀 RESUMING WORKFLOW FROM POSITION:", startPosition);


    // Execute the workflow starting from the next position
    const result = await executeWorkflow(
      {
        ...workflow,
        steps,
      },
      {
        startPosition,
        initialInput,
        initialOutput,
        workflowRunId: runId,
        onStepStart: async ({ step, input }) => {
          const mutation = `
            mutation CreateRunningStepRun(
              $workflow_run_id: uuid!
              $workflow_step_id: uuid!
              $status: String!
              $input: jsonb
              $attempt_count: Int!
            ) {
              insert_step_runs_one(
                object: {
                  workflow_run_id: $workflow_run_id
                  workflow_step_id: $workflow_step_id
                  status: $status
                  input: $input
                  attempt_count: $attempt_count
                }
              ) {
                id
                workflow_run_id
                workflow_step_id
                status
                input
                attempt_count
              }
            }
          `;

          await graphqlRequest(mutation, {
            workflow_run_id: runId,
            workflow_step_id: step.id,
            status: "running",
            input: input ?? null,
            attempt_count: 1,
          });
        },

        // ========================================
        // STEP COMPLETE
        // ========================================

        onStepComplete: async ({
          step,
          result,
          status,
          error,
          completedAt,
        }) => {
          const mutation = `
            mutation UpdateStepRun(
              $workflow_run_id: uuid!
              $workflow_step_id: uuid!
              $status: String!
              $output: jsonb
              $error: String
            ) {
              update_step_runs(
                where: {
                  workflow_run_id: { _eq: $workflow_run_id }
                  workflow_step_id: { _eq: $workflow_step_id }
                  status: { _eq: "running" }
                }
                _set: {
                  status: $status
                  output: $output
                  error: $error
                }
              ) {
                returning {
                  id
                  workflow_run_id
                  workflow_step_id
                  status
                  input
                  output
                  error
                  attempt_count
                }
              }
            }
          `;

          await graphqlRequest(mutation, {
            workflow_run_id: runId,
            workflow_step_id: step.id,
            status,
            output: result ?? null,
            error: error || null,
          });
        },
      }
    );


    console.log("🏁 RESUMED WORKFLOW RESULT:", result);


    // Update final workflow status
    const finalStatus = result.status;


    const updateRunMutation = `
      mutation UpdateWorkflowRun(
        $id: uuid!
        $status: String!
        $completed_at: timestamptz
      ) {
        update_workflow_runs_by_pk(
          pk_columns: { id: $id }
          _set: {
            status: $status
            completed_at: $completed_at
          }
        ) {
          id
          workflow_id
          status
          started_at
          completed_at
        }
      }
    `;


    const updatedRun = await graphqlRequest(updateRunMutation, {
      id: runId,
      status: finalStatus,
      completed_at:
        finalStatus === "running"
          ? null
          : new Date().toISOString(),
    });


    // ========================================
    // INCREMENT ORGANIZATION USAGE
    // ========================================


    if (result.status === "completed") {
      const incrementQuotaMutation = `
        mutation IncrementQuota($id: uuid!) {
          update_organizations_by_pk(
            pk_columns: { id: $id }
            _inc: {
              calls_used: 1
            }
          ) {
            id
            calls_used
            calls_allowed
          }
        }
      `;


      await graphqlRequest(incrementQuotaMutation, {
        id: workflow.org_id,
      });
    }


    res.json({
      success: true,
      workflow_run_id: runId,
      status: finalStatus,
      output: result.output || null,
      executionLog: result.executionLog || [],
      workflowRun:
        updatedRun.update_workflow_runs_by_pk,
    });
  } catch (error) {
    console.error("Approval error:", error);


    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});


// ========================================
// GET STEP RUNS FOR A WORKFLOW RUN
// ========================================


router.get("/workflow-runs/:runId/steps", requireAuth, async (req, res) => {
  try {
    const { runId } = req.params;


    const query = `
      query GetWorkflowRunWithSteps($runId: uuid!) {
        workflow_runs_by_pk(id: $runId) {
          id
          workflow_id
          status
          started_at
          completed_at


          step_runs(
            order_by: { created_at: asc }
          ) {
            id
            workflow_run_id
            workflow_step_id
            status
            input
            output
            error
            attempt_count
            created_at
          }
        }
      }
    `;


    const data = await graphqlRequest(query, {
      runId,
    });


    if (!data.workflow_runs_by_pk) {
      return res.status(404).json({
        error: "Workflow run not found",
      });
    }


    res.json({
      success: true,
      workflow_run_id: data.workflow_runs_by_pk.id,
      status: data.workflow_runs_by_pk.status,
      stepRuns: data.workflow_runs_by_pk.step_runs || [],
    });
  } catch (error) {
    console.error("Get step runs error:", error);


    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});


module.exports = router;