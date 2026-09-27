// New endpoint for updating issue labels
app.patch("/api/issues/:id/labels", async (req: Request, res: Response) => {
  const owner = String(req.query.owner || process.env.GITHUB_OWNER || "").trim();
  const repo = String(req.query.repo || "").trim();
  const issueId = Number(req.params.id);
  const { status, priority } = req.body || {};

  if (!owner || !repo || !isValidRepoPart(owner) || !isValidRepoPart(repo)) {
    return res.status(400).json({ error: "Provide valid owner and repo query parameters." });
  }
  if (!issueId || issueId <= 0) {
    return res.status(400).json({ error: "Provide a valid issue ID." });
  }

  const token = resolveToken(req);
  if (!token) {
    return res.status(401).json({ error: "No GitHub token configured." });
  }

  try {
    // First, fetch the current issue to get its labels
    const issue = await fetchIssueById(owner, repo, issueId, token);
    const currentLabels = issue.labels || [];
    
    // Prepare new labels array
    const newLabels = [...currentLabels];
    
    // Helper function to find label by name
    const findLabelIndex = (name: string) => {
      return newLabels.findIndex(label => {
        const labelName = typeof label === 'string' ? label : label.name;
        return labelName && labelName.toLowerCase() === name.toLowerCase();
      });
    };
    
    // Helper function to add or update a label
    const updateLabel = (namespace: string, value: string) => {
      const labelName = `${namespace}:${value}`;
      const index = findLabelIndex(labelName);
      
      if (index >= 0) {
        // Label already exists, no need to add it again
        return;
      }
      
      // Remove any existing label with the same namespace
      const namespacePrefix = `${namespace}:`;
      const existingIndex = newLabels.findIndex(label => {
        const labelName = typeof label === 'string' ? label : label.name;
        return labelName && labelName.startsWith(namespacePrefix);
      });
      
      if (existingIndex >= 0) {
        newLabels.splice(existingIndex, 1);
      }
      
      // Add the new label
      newLabels.push(labelName);
    };
    
    // Update status label if provided
    if (status !== undefined) {
      updateLabel("status", status);
    }
    
    // Update priority label if provided
    if (priority !== undefined) {
      updateLabel("priority", priority);
    }
    
    // Ensure labels exist in the repository
    const labelsToEnsure = newLabels.filter(label => {
      const labelName = typeof label === 'string' ? label : label.name;
      return labelName && (labelName.startsWith("status:") || labelName.startsWith("priority:"));
    }).map(label => typeof label === 'string' ? label : label.name);
    
    await ensureLabels(owner, repo, token, labelsToEnsure);
    
    // Replace all labels on the issue
    await addIssueLabels(token, owner, repo, issueId, newLabels);
    
    // Fetch the updated issue to return
    const updatedIssue = await fetchIssueById(owner, repo, issueId, token);
    
    return res.json({ 
      issue: updatedIssue,
      message: "Labels updated successfully."
    });
  } catch (error) {
    const apiError = error instanceof GitHubApiError ? error : null;
    const message = error instanceof Error ? error.message : String(error);
    return res.status(apiError?.statusCode || 500).json({
      error: "Failed to update issue labels.",
      details: apiError?.details || message,
    });
  }
});
