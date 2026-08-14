const express = require("express");
const { graphqlRequest } = require("./supabase");
const { executeWorkflow } = require("./workflowExecutor");

const router = express.Router();

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
router.post("/workflows", async (req, res) => {
  try {
    const {
      name,
      description,
      steps = [],
      org_id,
    } = req.body;

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

    const result = await executeWorkflow({
      ...workflow,
      steps,
      input: req.body?.input || null,
    });

    // ---------------------------------
    // Save step runs
    // ---------------------------------
    if (result.executionLog && result.executionLog.length > 0) {
      const stepRunObjects = result.executionLog.map((log) => ({
        workflow_run_id: workflowRun.id,
        workflow_step_id: log.step_id,
        status: log.status,
        input: log.input || null,
        output: log.result || null,
        error: log.error || null,
        attempt_count: 1,
      }));


      const stepRunsMutation = `
        mutation CreateStepRuns(
          $objects: [step_runs_insert_input!]!
        ) {
          insert_step_runs(
            objects: $objects
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


      await graphqlRequest(stepRunsMutation, {
        objects: stepRunObjects,
      });
    }


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


    // ---------------------------------
    // Return execution result
    // ---------------------------------


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

// Approve paused workflow and resume execution
router.post("/workflow-runs/:runId/approve", async (req, res) => {
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

    // Find the last completed step run
    const completedSteps = steps.filter((step) =>
      stepRuns.some(
        (run) => run.workflow_step_id === step.id && run.status === "completed"
      )
    );

    completedSteps.sort((a, b) => b.position - a.position);
    const lastCompletedStep = completedSteps[0];

    const startPosition = lastCompletedStep ? lastCompletedStep.position + 1 : 1;

    const lastRun = lastCompletedStep
      ? stepRuns.find((run) => run.workflow_step_id === lastCompletedStep.id)
      : null;

    let initialInput = null;
    if (lastRun && lastRun.output) {
      if (
        lastRun.output.status === "waiting_for_approval" &&
        lastRun.output.data !== undefined
      ) {
        initialInput = lastRun.output.data;
      } else {
        initialInput = lastRun.output;
      }
    }
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
      }
    );

    // Save step runs
    if (result.executionLog && result.executionLog.length > 0) {
      const stepRunObjects = result.executionLog.map((log) => ({
        workflow_run_id: runId,
        workflow_step_id: log.step_id,
        status: log.status,
        input: log.input || null,
        output: log.result || null,
        error: log.error || null,
        attempt_count: 1,
      }));

      const stepRunsMutation = `
        mutation CreateStepRuns(
          $objects: [step_runs_insert_input!]!
        ) {
          insert_step_runs(
            objects: $objects
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


      await graphqlRequest(stepRunsMutation, {
        objects: stepRunObjects,
      });
    }


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


module.exports = router;