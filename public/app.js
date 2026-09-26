import React, { useMemo, useState } from "https://esm.sh/react@18.3.1";
import { createRoot } from "https://esm.sh/react-dom@18.3.1/client";

function IssueLine({ issue }) {
  const status = issue.labels.status ? `status:${issue.labels.status}` : "";
  const priority = issue.labels.priority ? `priority:${issue.labels.priority}` : "";
  return React.createElement(
    "li",
    null,
    React.createElement("a", { href: issue.html_url, target: "_blank", rel: "noreferrer" }, `#${issue.number} ${issue.title}`),
    React.createElement("span", { className: "meta" }, ` ${status} ${priority}`)
  );
}

function App() {
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [state, setState] = useState("all");
  const [token, setToken] = useState(localStorage.getItem("gbm_token") || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);

  const canLoad = useMemo(() => owner.trim() && repo.trim(), [owner, repo]);

  async function loadIssues(event) {
    event.preventDefault();
    if (!canLoad) return;

    setLoading(true);
    setError("");

    try {
      localStorage.setItem("gbm_token", token);
      const response = await fetch(`/api/issues?owner=${encodeURIComponent(owner.trim())}&repo=${encodeURIComponent(repo.trim())}&state=${encodeURIComponent(state)}`, {
        headers: token ? { Authorization: ["Bearer", token].join(" ") } : {},
      });

      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Request failed");
      setData(body);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      "form",
      { onSubmit: loadIssues },
      React.createElement("label", null, "Owner", React.createElement("input", { value: owner, onChange: (e) => setOwner(e.target.value), required: true })),
      React.createElement("label", null, "Repository", React.createElement("input", { value: repo, onChange: (e) => setRepo(e.target.value), required: true })),
      React.createElement(
        "label",
        null,
        "State",
        React.createElement(
          "select",
          { value: state, onChange: (e) => setState(e.target.value) },
          React.createElement("option", { value: "all" }, "all"),
          React.createElement("option", { value: "open" }, "open"),
          React.createElement("option", { value: "closed" }, "closed")
        )
      ),
      React.createElement("label", null, "GitHub Token (optional if backend has GITHUB_TOKEN)", React.createElement("input", { value: token, onChange: (e) => setToken(e.target.value), type: "password" })),
      React.createElement("button", { type: "submit", disabled: !canLoad || loading }, loading ? "Loading..." : "Load Work Items")
    ),
    error && React.createElement("p", { style: { color: "crimson" } }, error),
    data &&
      React.createElement(
        "section",
        null,
        React.createElement("h2", null, `${data.repository.owner}/${data.repository.repo}`),
        React.createElement("p", null, `Issues: ${data.totals.issues} | Epics: ${data.totals.epics} | Bugs: ${data.totals.bugs}`),
        React.createElement(
          "h3",
          null,
          "Epics"
        ),
        React.createElement(
          "ul",
          null,
          data.hierarchy.epics.map((epic) =>
            React.createElement(
              "li",
              { key: `epic-${epic.number}` },
              React.createElement("strong", null, `${epic.title} (${epic.slug})`),
              React.createElement(
                "ul",
                null,
                epic.features.map((feature) =>
                  React.createElement(
                    "li",
                    { key: `feature-${feature.number}` },
                    `${feature.title} (${feature.slug})`,
                    React.createElement(
                      "ul",
                      null,
                      feature.tasks.map((task) => React.createElement(IssueLine, { key: `task-${task.number}`, issue: task }))
                    )
                  )
                )
              )
            )
          )
        ),
        React.createElement("h3", null, "Bugs"),
        React.createElement("ul", null, data.hierarchy.bugs.map((bug) => React.createElement(IssueLine, { key: `bug-${bug.number}`, issue: bug })))
      )
  );
}

createRoot(document.getElementById("root")).render(React.createElement(App));
