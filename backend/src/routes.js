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

    const result = await executeWorkflow({
      ...workflow,
      steps,
      input: req.body?.input || null,
    });

    res.json({
      success: true,
      workflow_id: id,
      ...result,
    });
  } catch (error) {
    console.error("Workflow execution error:", error);

    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});


module.exports = router;