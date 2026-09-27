// Update workitem label endpoint
app.post("/api/repos/:repo/issues/:issueNumber/label/:label", async (req: Request, res: Response) => {
  const owner = String(req.query.owner || process.env.GITHUB_OWNER || "").trim();
  const repo = String(req.params.repo).trim();
  const issueNumber = Number(req.params.issueNumber);
  const label = String(req.params.label).trim();

  if (!owner || !repo || !isValidRepoPart(owner) || !isValidRepoPart(repo)) {
    return res.status(400).json({ error: "Provide valid owner and repo parameters." });
  }
  if (!issueNumber || issueNumber <= 0) {
    return res.status(400).json({ error: "Provide a valid issue number." });
  }
  if (!label) {
    return res.status(400).json({ error: "Provide a valid label." });
  }

  const token = resolveToken(req);
  if (!token) {
    return res.status(401).json({ error: "No GitHub token configured." });
  }

  try {
    // If the label contains a colon, treat it as a namespaced label
    if (label.includes(":")) {
      const namespace = label.split(":")[0];
      // Fetch the issue to get its current labels
      const issue = await fetchIssueById(owner, repo, issueNumber, token);
      const existingLabels = issue.labels || [];
      
      // Remove all existing labels with the same namespace
      for (const existingLabel of existingLabels) {
        if (existingLabel.startsWith(`${namespace}:`)) {
          await removeIssueLabel(token, owner, repo, issueNumber, existingLabel);
        }
      }
    }
    
    // Add the new label
    await addIssueLabels(token, owner, repo, issueNumber, [label]);
    
    // Return 204 No Content on success
    return res.status(204).send();
  } catch (error) {
    const apiError = error instanceof GitHubApiError ? error : null;
    const message = error instanceof Error ? error.message : String(error);
    return res.status(apiError?.statusCode || 500).json({
      error: "Failed to update label on GitHub.",
      details: apiError?.details || message,
    });
  }
});