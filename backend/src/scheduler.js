const cron = require("node-cron");
const { graphqlRequest } = require("./supabase");
const { executeWorkflow } = require("./workflowExecutor");

const activeJobs = new Map(); // triggerId -> cronJobInstance

async function runScheduledWorkflow(trigger) {
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
            position
            type
            config
          }
        }
      }
    `;


    const data = await graphqlRequest(query, { id: trigger.workflow_id });
    const workflow = data.workflows_by_pk;


    if (!workflow) {
      console.error(
        "Scheduled workflow not found:",
        trigger.workflow_id
      );
      return;
    }


    // ========================================
    // SCHEDULED WORKFLOW QUOTA CHECK
    // ========================================


    const quotaQuery = `
      query GetOrganizationQuota($id: uuid!) {
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
      console.error(
        `Organization not found for scheduled workflow ${workflow.id}`
      );
      return;
    }


    if (
      organization.calls_allowed !== null &&
      organization.calls_used >= organization.calls_allowed
    ) {
      console.error(
        `⛔ Scheduled workflow blocked by quota: ${workflow.name} ` +
        `(${organization.calls_used}/${organization.calls_allowed})`
      );
      return;
    }


    console.log(
      `⏰ Running scheduled workflow: ${workflow.name}`
    );


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


    const runData = await graphqlRequest(
      createRunMutation,
      {
        workflow_id: workflow.id,
        status: "running",
      }
    );


    const workflowRun =
      runData.insert_workflow_runs_one;


    const result = await executeWorkflow(
      {
        ...workflow,
        steps: workflow.workflow_steps,
        input: {
          source: "scheduled_trigger",
          trigger_id: trigger.id,
        },
      },
      {
        workflowRunId: workflowRun.id,


        onStepStart: async ({ step, input }) => {
          const mutation = `
            mutation CreateStepRun(
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
      `🏁 Scheduled workflow run ${workflowRun.id} finished with status: ${finalStatus}`
    );

  } catch (error) {
    console.error("Scheduled workflow execution error:", error);
  }
}


async function syncSchedules() {
  try {
    const query = `
      query GetScheduleTriggers {
        workflow_triggers(where: { type: { _eq: "scheduled" } }) {
          id
          workflow_id
          config
        }
      }
    `;
    const data = await graphqlRequest(query);
    const triggers = data.workflow_triggers || [];


    console.log(`⏰ Scheduler found ${triggers.length} scheduled trigger(s)`);


    const triggerIds = new Set(triggers.map(t => t.id));


    // Stop and clear removed jobs
    for (const [id, job] of activeJobs.entries()) {
      if (!triggerIds.has(id)) {
        job.stop();
        activeJobs.delete(id);
        console.log(`⏰ Stopped scheduled trigger: ${id}`);
      }
    }


    // Add/Update jobs
    for (const trigger of triggers) {
      const cronExpr = trigger.config?.cron;
      if (!cronExpr) continue;


      const existingJob = activeJobs.get(trigger.id);
      if (existingJob) {
        if (existingJob.cronExpr === cronExpr) {
          continue; // No config change
        }
        existingJob.stop();
        activeJobs.delete(trigger.id);
      }


      try {
        const job = cron.schedule(cronExpr, () => {
          console.log(`🚀 Scheduled trigger fired: ${trigger.id}`);
          runScheduledWorkflow(trigger);
        });
        job.cronExpr = cronExpr;
        activeJobs.set(trigger.id, job);
        console.log(`⏰ Scheduled trigger ${trigger.id} with cron: "${cronExpr}"`);
      } catch (err) {
        console.error(`Invalid cron expression "${cronExpr}" for trigger ${trigger.id}:`, err);
      }
    }
  } catch (error) {
    console.error("Failed to sync schedules:", error);
  }
}

function startScheduler() {
  console.log("⏰ Scheduler service initialized.");
  syncSchedules();
  // Poll for config updates every minute
  cron.schedule("* * * * *", syncSchedules);
}

module.exports = {
  startScheduler,
};
