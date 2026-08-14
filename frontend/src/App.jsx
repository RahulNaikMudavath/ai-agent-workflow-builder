import { useState } from "react";

const ORG_ID = "03538bbd-b9fe-44a4-88c8-cc68713ead78";
const API_URL = "http://localhost:5001/api";

function App() {
  const [workflowName, setWorkflowName] = useState("");
  const [steps, setSteps] = useState([]);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  const addStep = (type) => {
    let config = {};

    if (type === "llm_call") {
      config = {
        prompt: "Analyze the user request and provide a helpful response.",
      };
    }

    if (type === "http_request") {
      config = {
        url: "https://jsonplaceholder.typicode.com/todos/1",
        method: "GET",
      };
    }

    if (type === "conditional_branch") {
      config = {
        condition: "response is not empty",
      };
    }

    if (type === "approval_gate") {
      config = {
        message: "Please approve this workflow before continuing.",
      };
    }

    setSteps([
      ...steps,
      {
        id: Date.now(),
        type,
        config,
      },
    ]);
  };

  const removeStep = (id) => {
    setSteps(steps.filter((step) => step.id !== id));
  };

  const updateStepConfig = (id, field, value) => {
    setSteps(
      steps.map((step) =>
        step.id === id
          ? {
              ...step,
              config: {
                ...step.config,
                [field]: value,
              },
            }
          : step
      )
    );
  };

  const saveWorkflow = async () => {
    if (!workflowName.trim()) {
      alert("Please enter a workflow name");
      return;
    }

    setSaving(true);

    try {
      const response = await fetch(`${API_URL}/workflows`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: workflowName,
          description: "Created from AI Agent Workflow Builder",
          org_id: ORG_ID,
          steps: steps.map((step) => ({
            type: step.type,
            config: step.config,
          })),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to save workflow");
      }

      alert("Workflow saved successfully! 🎉");
      console.log("Saved workflow:", data);
    } catch (error) {
      console.error("Save error:", error);
      alert(error.message);
    } finally {
      setSaving(false);
    }
  };

  const runWorkflow = async () => {
    if (!workflowName.trim()) {
      alert("Please enter a workflow name");
      return;
    }

    try {
      setRunning(true);

      const saveResponse = await fetch(`${API_URL}/workflows`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: workflowName,
          description: "Created from AI Agent Workflow Builder",
          org_id: ORG_ID,
          steps: steps.map((step) => ({
            type: step.type,
            config: step.config,
          })),
        }),
      });

      const workflow = await saveResponse.json();

      if (!saveResponse.ok) {
        throw new Error(workflow.error || "Failed to save workflow");
      }

      const runResponse = await fetch(
        `${API_URL}/workflows/${workflow.id}/run`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            input: "Please analyze this customer support request.",
          }),
        }
      );

      const result = await runResponse.json();

      if (!runResponse.ok) {
        const failedStep = result.executionLog?.find(
          (step) => step.status === "failed"
        );

        throw new Error(
          failedStep
            ? `Step: ${failedStep.type}\nError: ${
                failedStep.error || "Unknown error"
              }`
            : result.error || "Workflow execution failed"
        );
      }

      console.log("Workflow execution result:", result);

      if (result.status === "completed") {
        alert(
          `Workflow completed successfully! 🎉\n\nSteps executed: ${result.executionLog.length}`
        );
      } else {
        alert("Workflow failed!");
      }
    } catch (error) {
      console.error("Workflow execution error:", error);
      alert(error.message);
    } finally {
      setRunning(false);
    }
  };

  const getStepTitle = (type) => {
    if (type === "llm_call") return "LLM Call";
    if (type === "http_request") return "HTTP Request";
    if (type === "conditional_branch") return "Conditional Branch";
    if (type === "approval_gate") return "Approval Gate";

    return type;
  };

  const getStepDescription = (type) => {
    if (type === "llm_call") {
      return "Generate a response using an LLM";
    }

    if (type === "http_request") {
      return "Call an external HTTP endpoint";
    }

    if (type === "conditional_branch") {
      return "Branch workflow based on a condition";
    }

    if (type === "approval_gate") {
      return "Pause workflow until approval";
    }

    return "";
  };

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>AI Agent Workflow Builder</h1>
          <p>Create and execute automated AI workflows</p>
        </div>

        <div>
          <button
            className="save-btn"
            onClick={saveWorkflow}
            disabled={saving}
          >
            {saving ? "Saving..." : "💾 Save Workflow"}
          </button>

          <button
            className="run-btn"
            onClick={runWorkflow}
            disabled={running}
          >
            {running ? "Running..." : "▶ Run Workflow"}
          </button>
        </div>
      </header>

      <main className="container">
        <section className="workflow-info">
          <label>Workflow Name</label>

          <input
            type="text"
            placeholder="e.g. Customer Support Agent"
            value={workflowName}
            onChange={(e) => setWorkflowName(e.target.value)}
          />
        </section>

        <div className="builder">
          <aside className="sidebar">
            <h2>Steps</h2>
            <p>Add steps to your workflow</p>

            <button onClick={() => addStep("llm_call")}>
              🤖 LLM Call
            </button>

            <button onClick={() => addStep("http_request")}>
              🌐 HTTP Request
            </button>

            <button onClick={() => addStep("conditional_branch")}>
              🔀 Conditional Branch
            </button>

            <button onClick={() => addStep("approval_gate")}>
              👤 Approval Gate
            </button>
          </aside>

          <section className="canvas">
            <h2>Workflow</h2>

            {steps.length === 0 ? (
              <div className="empty">
                <div>⚡</div>
                <h3>No steps yet</h3>
                <p>
                  Add a step from the left to start building your workflow.
                </p>
              </div>
            ) : (
              <div className="steps">
                {steps.map((step, index) => (
                  <div className="step" key={step.id}>
                    <div className="step-number">{index + 1}</div>

                    <div className="step-content">
                      <strong>{getStepTitle(step.type)}</strong>

                      <span>{getStepDescription(step.type)}</span>

                      {step.type === "llm_call" && (
                        <textarea
                          value={step.config.prompt || ""}
                          placeholder="Enter LLM prompt"
                          onChange={(e) =>
                            updateStepConfig(
                              step.id,
                              "prompt",
                              e.target.value
                            )
                          }
                        />
                      )}

                      {step.type === "http_request" && (
                        <>
                          <input
                            type="text"
                            value={step.config.url || ""}
                            placeholder="HTTP URL"
                            onChange={(e) =>
                              updateStepConfig(
                                step.id,
                                "url",
                                e.target.value
                              )
                            }
                          />

                          <select
                            value={step.config.method || "GET"}
                            onChange={(e) =>
                              updateStepConfig(
                                step.id,
                                "method",
                                e.target.value
                              )
                            }
                          >
                            <option value="GET">GET</option>
                            <option value="POST">POST</option>
                            <option value="PUT">PUT</option>
                            <option value="DELETE">DELETE</option>
                          </select>
                        </>
                      )}

                      {step.type === "conditional_branch" && (
                        <input
                          type="text"
                          value={step.config.condition || ""}
                          placeholder="Enter condition"
                          onChange={(e) =>
                            updateStepConfig(
                              step.id,
                              "condition",
                              e.target.value
                            )
                          }
                        />
                      )}

                      {step.type === "approval_gate" && (
                        <input
                          type="text"
                          value={step.config.message || ""}
                          placeholder="Approval message"
                          onChange={(e) =>
                            updateStepConfig(
                              step.id,
                              "message",
                              e.target.value
                            )
                          }
                        />
                      )}
                    </div>

                    <button
                      className="delete-btn"
                      onClick={() => removeStep(step.id)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

export default App;