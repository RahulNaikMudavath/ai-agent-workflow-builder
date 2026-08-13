const express = require("express");
const supabase = require("./supabase");

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
    const { data, error } = await supabase
      .from("workflows")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({
        error: error.message,
      });
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

// Get one workflow with its steps
router.get("/workflows/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { data: workflow, error: workflowError } = await supabase
      .from("workflows")
      .select("*")
      .eq("id", id)
      .single();

    if (workflowError) {
      return res.status(404).json({
        error: workflowError.message,
      });
    }

    const { data: steps, error: stepsError } = await supabase
      .from("workflow_steps")
      .select("*")
      .eq("workflow_id", id)
      .order("position", { ascending: true });

    if (stepsError) {
      return res.status(500).json({
        error: stepsError.message,
      });
    }

    res.json({
      ...workflow,
      steps,
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

// Create workflow
router.post("/workflows", async (req, res) => {
  try {
    const { name, description, steps } = req.body;

    if (!name) {
      return res.status(400).json({
        error: "Workflow name is required",
      });
    }

    const { data: workflow, error: workflowError } = await supabase
      .from("workflows")
      .insert({
        name,
        description: description || null,
        status: "draft",
      })
      .select()
      .single();

    if (workflowError) {
      return res.status(500).json({
        error: workflowError.message,
      });
    }

    if (steps && steps.length > 0) {
      const stepRows = steps.map((step, index) => ({
        workflow_id: workflow.id,
        position: index + 1,
        type: step.type,
        config: step.config || {},
      }));

      const { error: stepsError } = await supabase
        .from("workflow_steps")
        .insert(stepRows);

      if (stepsError) {
        return res.status(500).json({
          error: stepsError.message,
        });
      }
    }

    res.status(201).json({
      ...workflow,
      steps: steps || [],
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

module.exports = router;