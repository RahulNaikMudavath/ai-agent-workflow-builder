const { graphqlRequest } = require("./supabase");

async function executeWithRetry(fn, retries = 1) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  throw lastError;
}

async function executeWorkflow(workflow, options = {}) {
  if (!workflow || !workflow.steps) {
    throw new Error("Invalid workflow");
  }

  const startPosition = options.startPosition || 1;

  let currentData = {
    input:
      options.initialInput !== undefined
        ? options.initialInput
        : workflow.input || null,
    output:
      options.initialOutput !== undefined
        ? options.initialOutput
        : null,
  };

  const executionLog = [];

  for (const step of workflow.steps) {
    if (step.position < startPosition) {
      continue;
    }

    const stepInput =
      currentData.output !== null &&
      currentData.output !== undefined
        ? currentData.output
        : currentData.input;

    const startedAt = new Date().toISOString();

    // ========================================
    // STEP START CALLBACK
    // ========================================

    if (options.onStepStart) {
      await options.onStepStart({
        step,
        input: stepInput,
      });
    }

    try {
      let result;

      switch (step.type) {
        case "llm_call":
          result = await executeWithRetry(
            () => executeLLMCall(step, currentData),
            1
          );
          break;

        case "http_request":
          result = await executeWithRetry(
            () => executeHTTPRequest(step, currentData),
            1
          );
          break;

        case "db_write":
          result = await executeDBWrite(
            step,
            currentData,
            workflow.id,
            options.workflowRunId
          );
          break;

        case "conditional_branch":
          result = executeConditionalBranch(step, currentData);
          break;

        case "approval_gate":
          result = executeApprovalGate(step, currentData);
          break;

        default:
          throw new Error(`Unsupported step type: ${step.type}`);
      }
      

      currentData.output = result;


      const isWaitingForApproval =
        result && result.status === "waiting_for_approval";


      const isConditionalFalse =
        step.type === "conditional_branch" &&
        result &&
        result.condition === false;


      const log = {
        step_id: step.id,
        position: step.position,
        type: step.type,
        status: isWaitingForApproval ? "paused" : "completed",
        input: stepInput,
        result,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
      };


      executionLog.push(log);


      // ========================================
      // STEP COMPLETE CALLBACK
      // ========================================


      if (options.onStepComplete) {
        await options.onStepComplete({
          step,
          input: stepInput,
          result,
          status: log.status,
          startedAt,
          completedAt: log.completed_at,
        });
      }


      // ========================================
      // APPROVAL PAUSE
      // ========================================


      if (isWaitingForApproval) {
        return {
          status: "waiting_for_approval",
          output: currentData.output,
          executionLog,
        };
      }


      // ========================================
      // CONDITIONAL BRANCH FALSE
      // ========================================


      if (isConditionalFalse) {
        return {
          status: "completed",
          output: currentData.output,
          executionLog,
        };
      }
    } catch (error) {
      const log = {
        step_id: step.id,
        position: step.position,
        type: step.type,
        status: "failed",
        input: stepInput,
        error: error.message,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
      };

      executionLog.push(log);

      // ========================================
      // STEP FAILED CALLBACK
      // ========================================

      if (options.onStepComplete) {
        await options.onStepComplete({
          step,
          input: stepInput,
          result: null,
          status: "failed",
          error: error.message,
          startedAt,
          completedAt: log.completed_at,
        });
      }

      return {
        status: "failed",
        error: error.message,
        executionLog,
      };
    }
  }

  return {
    status: "completed",
    output: currentData.output,
    executionLog,
  };
}


// ===============================
// LLM CALL
// ===============================

async function executeLLMCall(step, currentData) {
  const config = step.config || {};

  const prompt =
    config.prompt ||
    "Analyze the input and provide a helpful response.";

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    // Keep the workflow executable even when an LLM key
    // has not been configured yet.
    return {
      message: "LLM step reached successfully",
      prompt,
      input: currentData.output || currentData.input,
    };
  }

  const response = await fetch(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM API error: ${errorText}`);
  }

  const data = await response.json();

  return data.choices?.[0]?.message?.content || "";
}


// ===============================
// HTTP REQUEST
// ===============================

async function executeHTTPRequest(step, currentData) {
  const config = step.config || {};

  if (!config.url) {
    throw new Error("HTTP Request step requires a URL");
  }

  const method = (config.method || "GET").toUpperCase();

  const options = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(config.headers || {}),
    },
  };

  if (method !== "GET" && method !== "HEAD") {
    options.body = JSON.stringify(
      config.body || {
        input: currentData.output,
      }
    );
  }

  const response = await fetch(config.url, options);

  const contentType = response.headers.get("content-type") || "";

  const result = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    throw new Error(
      `HTTP request failed with status ${response.status}`
    );
  }

  return result;
}


// ===============================
// CONDITIONAL BRANCH
// ===============================

function executeConditionalBranch(step, currentData) {
  const config = step.config || {};

  const condition = config.condition || "";

  if (!condition) {
    return {
      condition: true,
      message: "No condition specified",
    };
  }

  const output = currentData.output;

  // Basic assignment requirement:
  // support simple "response is not empty" condition.
  if (condition === "response is not empty") {
    const isNotEmpty =
      output !== null &&
      output !== undefined &&
      output !== "";

    return {
      condition: isNotEmpty,
      branch: isNotEmpty ? "true" : "false",
    };
  }

  return {
    condition: false,
    branch: "false",
    message: `Condition not recognized: ${condition}`,
  };
}


// ===============================
// APPROVAL GATE
// ===============================

function executeApprovalGate(step, currentData) {
  const config = step.config || {};

  return {
    status: "waiting_for_approval",
    message: config.message || "Workflow requires approval",
    approved: false,
    data: currentData.output,
  };
}


// ===============================
// DB WRITE
// ===============================


async function executeDBWrite(
  step,
  currentData,
  workflowId,
  workflowRunId
) {
  if (!workflowId) {
    throw new Error("DB Write requires workflow ID");
  }

  if (!workflowRunId) {
    throw new Error("DB Write requires workflow run ID");
  }

  const dataToSave =
    currentData.output !== null &&
    currentData.output !== undefined
      ? currentData.output
      : currentData.input;

  const mutation = `
    mutation CreateWorkflowData(
      $workflow_id: uuid!
      $workflow_run_id: uuid!
      $data: jsonb!
    ) {
      insert_workflow_data_one(
        object: {
          workflow_id: $workflow_id
          workflow_run_id: $workflow_run_id
          data: $data
        }
      ) {
        id
        workflow_id
        workflow_run_id
        data
        created_at
      }
    }
  `;

  const result = await graphqlRequest(mutation, {
    workflow_id: workflowId,
    workflow_run_id: workflowRunId,
    data: dataToSave,
  });

  if (!result.insert_workflow_data_one) {
    throw new Error("Failed to save workflow data");
  }

  return result.insert_workflow_data_one;
}


module.exports = {
  executeWorkflow,
};