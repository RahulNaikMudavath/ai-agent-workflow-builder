import { useEffect, useRef, useState } from "react";
import { nhost } from "./nhost";

const API_URL =
  import.meta.env.VITE_API_URL || "http://localhost:5001/api";

function App() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [user, setUser] = useState(null);
  const [loggingIn, setLoggingIn] = useState(false);

  const getAuthHeaders = async () => {
    const session = await nhost.refreshSession(0);


    console.log("🔥 SESSION:", session);
    console.log("🔥 ACCESS TOKEN:", session?.accessToken);
    console.log("ACTUAL USER:", session?.user);
    console.log(
      "ACTUAL TOKEN PAYLOAD:",
      JSON.parse(atob(session.accessToken.split(".")[1]))
    );


    console.log("ACCESS TOKEN EXISTS:", !!session?.accessToken);


    if (!session?.accessToken) {
      throw new Error("No valid Nhost session. Please login again.");
    }


    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.accessToken}`,
    };
  };

  const [workflowName, setWorkflowName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [steps, setSteps] = useState([]);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [pausedRunId, setPausedRunId] = useState(null);
  const [approving, setApproving] = useState(false);
  const [stepRuns, setStepRuns] = useState([]);
  const [activeRunId, setActiveRunId] = useState(null);

  const subscriptionRef = useRef(null);
  const pollingIntervalRef = useRef(null);
  const approvalInProgressRef = useRef(false);


  useEffect(() => {
    const webhookRunId = new URLSearchParams(window.location.search).get("runId");


    if (webhookRunId) {
      console.log("🔥 WEBHOOK RUN FROM URL:", webhookRunId);
      setPausedRunId(webhookRunId);
      startPolling(webhookRunId);
    }
  }, []);


  const startPolling = (runId) => {
    if (!runId) return;


    subscribeToStepRuns(runId);
  };


  const subscribeToStepRuns = (runId) => {
    if (!runId) return;


    setActiveRunId(runId);


    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }


    const poll = async () => {
      try {
        const response = await fetch(
          `${API_URL}/workflow-runs/${runId}/steps`,
          {
            method: "GET",
            headers: await getAuthHeaders(),
          }
        );


        if (!response.ok) {
          console.error("Polling failed:", response.status);
          return;
        }


        const data = await response.json();


        console.log("🔥 UPDATED STEPS:", data);


        const runs =
          data.stepRuns ||
          data.steps ||
          data.data ||
          [];


        console.log("📋 STEP RUNS:", runs);


        setStepRuns(runs);


        // Update the visible workflow cards
        setSteps((currentSteps) =>
          currentSteps.map((step) => {
            const stepRun = runs.find(
              (run) => run.workflow_step_id === step.id
            );


            if (!stepRun) {
              return step;
            }


            console.log(
              `🔄 Step ${step.type}: ${step.status} → ${stepRun.status}`
            );


            return {
              ...step,
              status: stepRun.status,
            };
          })
        );


        const status =
          data.status ||
          data.runStatus ||
          data.workflowRun?.status;


        console.log("📊 WORKFLOW STATUS:", status);


        if (
          status === "completed" ||
          status === "failed" ||
          (status === "paused" && !approvalInProgressRef.current)
        ) {
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }
        }


        const hasPausedStep = runs.some(
          (run) => run.status === "paused"
        );


        if (
          !approvalInProgressRef.current &&
          (hasPausedStep || status === "paused")
        ) {
          console.log("🟡 WORKFLOW PAUSED:", runId);
          setPausedRunId(runId);
        }


        if (status === "running") {
          console.log("🟢 WORKFLOW RUNNING:", runId);
          setPausedRunId(null);
        }


        if (
          status === "completed" ||
          status === "failed"
        ) {
          console.log("🏁 WORKFLOW FINISHED:", status);
          setPausedRunId(null);
        }


      } catch (error) {
        console.error("❌ Polling error:", error);
      }
    };


    poll();
    pollingIntervalRef.current = setInterval(poll, 1000);
  };

  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, []);

  const login = async () => {
    if (!email.trim() || !password) {
      alert("Enter email and password");
      return;
    }

    try {
      setLoggingIn(true);

      const response = await nhost.auth.signInEmailPassword({
        email,
        password,
      });

      console.log("NHOST LOGIN RESPONSE:", response);

      if (response.error) {
        throw new Error(response.error.message);
      }

      const session =
        response.body?.session ||
        response.session ||
        nhost.getUserSession();

      if (!session) {
        throw new Error("Login failed: no session returned");
      }

      console.log("LOGIN SUCCESS:", session);

      setUser(session.user);
    } catch (error) {
      console.error("Login error:", error);
      alert(error.message);
    } finally {
      setLoggingIn(false);
    }
  };

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

    if (type === "db_write") {
      config = {};
    }


    if (type === "notify") {
      config = {
        channel: "log",
        message: "Workflow completed successfully.",
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
        headers: await getAuthHeaders(),
        body: JSON.stringify({
          name: workflowName,
          description: "Created from AI Agent Workflow Builder",
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


      if (data.steps && data.steps.length > 0) {
        setSteps(data.steps);
      }
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
        headers: await getAuthHeaders(),
        body: JSON.stringify({
          name: workflowName,
          description: "Created from AI Agent Workflow Builder",
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


      if (workflow.steps && workflow.steps.length > 0) {
        setSteps(workflow.steps);
      }

      const runResponse = await fetch(
        `${API_URL}/workflows/${workflow.id}/start`,
        {
          method: "POST",
          headers: await getAuthHeaders(),
          body: JSON.stringify({
            input: "Please analyze this customer support request.",
          }),
        }
      );

      const runData = await runResponse.json();


      if (!runResponse.ok || !runData.success) {
        throw new Error(runData.error || "Failed to start workflow");
      }


      const runId = runData.workflow_run_id;


      console.log("Workflow started:", runId);

      setActiveRunId(runId);

      if (runId) {
        console.log("🚀 Starting polling for:", runId);
        startPolling(runId);
      }
    } catch (error) {
      console.error("Workflow execution error:", error);
      alert(error.message);
    } finally {
      setRunning(false);
    }
  };
const approveWorkflow = async () => {
  if (!pausedRunId || approving || approvalInProgressRef.current) {
    return;
  }


  const runId = pausedRunId;


  try {
    setApproving(true);
    approvalInProgressRef.current = true;


    console.log("🟢 Approving workflow:", runId);


    const response = await fetch(
      `${API_URL}/workflow-runs/${runId}/approve`,
      {
        method: "POST",
        headers: await getAuthHeaders(),
        body: JSON.stringify({}),
      }
    );


    const data = await response.json();


    console.log("🟢 APPROVAL RESPONSE:", data);


    if (!response.ok || !data.success) {
      throw new Error(
        data.error || "Failed to approve workflow"
      );
    }


    console.log("✅ Workflow approval successful");


    // Immediately hide approval UI
    setPausedRunId(null);


    // Refresh the exact run after backend has resumed it
    setTimeout(() => {
      subscribeToStepRuns(runId);
    }, 500);


    console.log(
      "🔄 Workflow resumed. Monitoring run:",
      runId
    );


  } catch (error) {
    console.error("❌ Approval error:", error);
    alert(error.message);
  } finally {
    setApproving(false);


    setTimeout(() => {
      approvalInProgressRef.current = false;
    }, 1000);
  }
};

 

  const getStepTitle = (type) => {
    if (type === "llm_call") return "LLM Call";
    if (type === "http_request") return "HTTP Request";
    if (type === "conditional_branch") return "Conditional Branch";
    if (type === "approval_gate") return "Approval Gate";
    if (type === "db_write") return "DB Write";
    if (type === "notify") return "Notify";

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

    if (type === "db_write") {
      return "Save workflow data to the database";
    }


    if (type === "notify") {
      return "Send a workflow notification";
    }

    return "";
  };

  if (!user) {
    return (
      <div className="app" style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", background: "#0f111a" }}>
        <div className="login-box" style={{ width: "100%", maxWidth: "420px", padding: "40px", borderRadius: "16px", background: "#151823", border: "1px solid #292d3e", boxShadow: "0 20px 40px rgba(0,0,0,0.4)" }}>
          <h1 style={{ fontSize: "28px", fontWeight: 800, margin: "0 0 10px 0", color: "#fff", textAlign: "center", background: "linear-gradient(135deg, #7c3aed, #4f46e5)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            AI Agent Workflow Builder
          </h1>
          <p style={{ margin: "0 0 30px 0", color: "#9ca3af", textAlign: "center", fontSize: "14px" }}>
            Sign in to continue
          </p>


          <div style={{ marginBottom: "20px" }}>
            <label style={{ display: "block", marginBottom: "8px", fontSize: "13px", fontWeight: 500, color: "#d1d5db" }}>
              Email Address
            </label>
            <input
              type="email"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "14px 15px",
                borderRadius: "12px",
                border: "1px solid #303044",
                background: "#0d0d15",
                color: "#fff",
                outline: "none",
                fontSize: "14px",
              }}
            />
          </div>


          <div style={{ marginBottom: "30px" }}>
            <label
              style={{
                display: "block",
                marginBottom: "8px",
                fontSize: "13px",
                fontWeight: 500,
                color: "#d1d5db",
              }}
            >
              Password
            </label>


            <div style={{ position: "relative" }}>
              <input
                type={showPassword ? "text" : "password"}
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    login();
                  }
                }}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "14px 48px 14px 15px",
                  borderRadius: "12px",
                  border: "1px solid #303044",
                  background: "#0d0d15",
                  color: "#fff",
                  outline: "none",
                  fontSize: "14px",
                }}
              />


              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: "absolute",
                  right: "10px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  border: "none",
                  background: "transparent",
                  color: "#9ca3af",
                  cursor: "pointer",
                  fontSize: "16px",
                }}
              >
                {showPassword ? "🙈" : "👁️"}
              </button>
            </div>
          </div>


          {/* Sign In */}
          <button
            onClick={login}
            disabled={loggingIn}
            style={{
              width: "100%",
              padding: "14px",
              borderRadius: "12px",
              border: "none",
              background: loggingIn
                ? "#4c3a75"
                : "linear-gradient(135deg, #7c3aed, #4f46e5)",
              color: "#fff",
              fontSize: "15px",
              fontWeight: 700,
              cursor: loggingIn ? "not-allowed" : "pointer",
              boxShadow: loggingIn
                ? "none"
                : "0 12px 30px rgba(124, 58, 237, 0.3)",
            }}
          >
            {loggingIn ? "Signing in..." : "Sign In →"}
          </button>


          {/* Footer */}
          <div
            style={{
              marginTop: "28px",
              paddingTop: "20px",
              borderTop: "1px solid #262636",
              textAlign: "center",
              color: "#6b7280",
              fontSize: "12px",
            }}
          >
            Secure authentication powered by Nhost
          </div>
        </div>
      </div>
    );
  }

  const formatOutput = (value) => {
    if (value === null || value === undefined) return "";


    if (typeof value === "string") {
      return value;
    }


    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  };


  const getStepStatus = (step) => {
    const stepRun = stepRuns.find(
      (run) => run.workflow_step_id === step.id
    );


    return stepRun?.status || step.status || "pending";
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

          {pausedRunId && (
            <button
              className="save-btn"
              onClick={approveWorkflow}
              disabled={approving}
            >
              {approving ? "Approving..." : "✅ Approve Workflow"}
            </button>
          )}

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

            <button onClick={() => addStep("db_write")}>
              💾 DB Write
            </button>


            <button onClick={() => addStep("notify")}>
              🔔 Notify
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
              <>
                <div className="steps">
                {steps.map((step, index) => {
                  const stepRun = stepRuns.find(
                    (run) => run.workflow_step_id === step.id
                  );

                  const stepStatus = stepRun?.status || "pending";

                  return (
                    <div className="step" key={step.id}>
                      <div className="step-number">{index + 1}</div>

                      <div className="step-content">
                        <strong>{getStepTitle(step.type)}</strong>

                        <span>{getStepDescription(step.type)}</span>

                        <div className="step-status">
                          Status: {getStepStatus(step)}
                        </div>

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
                          <>
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
                            {pausedRunId && (
                              <button
                                onClick={approveWorkflow}
                                disabled={approving}
                                className="mt-4 rounded-lg bg-green-600 px-5 py-2.5 font-semibold text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {approving ? "Approving..." : "✅ Approve & Continue"}
                              </button>
                            )}
                          </>
                        )}


                        {step.type === "notify" && (
                          <>
                            <input
                              type="text"
                              value={step.config.channel || "log"}
                              placeholder="Notification channel"
                              onChange={(e) =>
                                updateStepConfig(
                                  step.id,
                                  "channel",
                                  e.target.value
                                )
                              }
                            />


                            <input
                              type="text"
                              value={step.config.message || ""}
                              placeholder="Notification message"
                              onChange={(e) =>
                                updateStepConfig(
                                  step.id,
                                  "message",
                                  e.target.value
                                )
                              }
                            />
                          </>
                        )}
                      </div>

                      <button
                        className="delete-btn"
                        onClick={() => removeStep(step.id)}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>

              {stepRuns.length > 0 && (
                <div className="mt-6 rounded-xl border border-gray-700 bg-gray-900 p-6">
                  <h2 className="text-xl font-bold text-white">
                    Workflow Execution
                  </h2>


                  <p className="mt-1 mb-5 text-sm text-gray-400">
                    Step-by-step execution results
                  </p>


                  <div className="space-y-4">
                    {stepRuns.map((run, index) => {
                      const step = steps.find(
                        (s) => s.id === run.workflow_step_id
                      );


                      const title =
                        step?.type === "llm_call"
                          ? "LLM Call"
                          : step?.type === "conditional_branch"
                          ? "Conditional Branch"
                          : step?.type === "http_request"
                          ? "HTTP Request"
                          : step?.type === "approval_gate"
                          ? "Approval Gate"
                          : step?.type === "db_write"
                          ? "DB Write"
                          : step?.type === "notify"
                          ? "Notify"
                          : `Step ${index + 1}`;


                      return (
                        <div
                          key={run.id}
                          className="rounded-lg border border-gray-700 bg-black p-4"
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <h3 className="font-semibold text-white">
                                {title}
                              </h3>


                              <p className="text-sm text-gray-400">
                                Status: {run.status}
                              </p>
                            </div>


                            <span className="rounded-full bg-purple-500/20 px-3 py-1 text-xs font-semibold text-purple-300">
                              {run.status}
                            </span>
                          </div>


                          {run.output !== null &&
                            run.output !== undefined && (
                              <div className="mt-4">
                                <p className="mb-2 text-xs font-semibold uppercase text-gray-500">
                                  Output
                                </p>


                                <pre className="max-h-60 overflow-auto rounded-lg bg-gray-950 p-4 text-sm text-green-300">
                                  {formatOutput(run.output)}
                                </pre>
                              </div>
                            )}


                          {run.error && (
                            <div className="mt-3 rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
                              ❌ {run.error}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}


              {pausedRunId && (
                <div className="mt-6 rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-5">
                  <div className="mb-3">
                    <h3 className="text-lg font-semibold text-yellow-400">
                      ⏸ Workflow Awaiting Approval
                    </h3>

                    <p className="mt-1 text-sm text-gray-400">
                      This workflow is paused at the approval gate.
                    </p>
                  </div>

                  <button
                    onClick={approveWorkflow}
                    disabled={approving}
                    className="rounded-lg bg-green-600 px-5 py-2 font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    {approving ? "Approving..." : "✓ Approve & Continue"}
                  </button>
                </div>
              )}
            </>
          )}
          </section>
        </div>
      </main>
    </div>
  );
}

export default App;