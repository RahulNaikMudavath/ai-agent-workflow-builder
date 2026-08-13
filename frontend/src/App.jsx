import { useState } from "react";

const GRAPHQL_URL =
  "https://ohjyjminbhlrvfadtfjn.hasura.ap-south-1.nhost.run/v1/graphql";

const ORG_ID = "03538bbd-b9fe-44a4-88c8-cc68713ead78";

function App() {
  const [workflowName, setWorkflowName] = useState("");
  const [steps, setSteps] = useState([]);
  const [saving, setSaving] = useState(false);

  const addStep = (type) => {
    setSteps([
      ...steps,
      {
        id: Date.now(),
        type,
        config: {},
      },
    ]);
  };

  const removeStep = (id) => {
    setSteps(steps.filter((step) => step.id !== id));
  };

  const saveWorkflow = async () => {
    if (!workflowName.trim()) {
      alert("Please enter a workflow name");
      return;
    }

    setSaving(true);

    try {
      const response = await fetch("http://localhost:5001/api/workflows", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: workflowName,
          description: "Created from AI Agent Workflow Builder",
          org_id: "03538bbd-b9fe-44a4-88c8-cc68713ead78",
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
      console.error(error);
      alert(error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>AI Agent Workflow Builder</h1>
          <p>Create and execute automated AI workflows</p>
        </div>

        <div>
          <button className="save-btn" onClick={saveWorkflow}>
            💾 Save Workflow
          </button>

          <button className="run-btn">
            ▶ Run Workflow
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
                      <strong>{step.type}</strong>

                      <span>
                        {step.type === "llm_call" &&
                          "Generate a response using an LLM"}

                        {step.type === "http_request" &&
                          "Call an external HTTP endpoint"}

                        {step.type === "conditional_branch" &&
                          "Branch workflow based on a condition"}

                        {step.type === "approval_gate" &&
                          "Pause workflow until approval"}
                      </span>
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