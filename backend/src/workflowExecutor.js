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

    const startedAt = new Date().toISOString();

    try {
      let result;

      switch (step.type) {
        case "llm_call":
          result = await executeLLMCall(step, currentData);
          break;

        case "http_request":
          result = await executeHTTPRequest(step, currentData);
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

      const stepInput =
        currentData.output !== null &&
        currentData.output !== undefined
          ? currentData.output
          : currentData.input;

      currentData.output = result;

      executionLog.push({
        step_id: step.id,
        position: step.position,
        type: step.type,
        status: "completed",
        input: stepInput,
        result,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
      });

      if (result && result.status === "waiting_for_approval") {
        return {
          status: "waiting_for_approval",
          output: currentData.output,
          executionLog,
        };
      }
    } catch (error) {
      executionLog.push({
        step_id: step.id,
        position: step.position,
        type: step.type,
        status: "failed",
        error: error.message,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
      });

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


module.exports = {
  executeWorkflow,
};