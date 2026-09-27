// Update workitem label endpoint implementation
// This file contains the endpoint implementation for issue #29
// This should be added to src/server/index.ts after the AI Conversation endpoints

import { type Request, type Response } from "express";
import { fetchIssueById, removeIssueLabel, addIssueLabels } from "./github";
import { isValidRepoPart, resolveToken } from "./index";

export function createLabelEndpoint(app: any) {
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
      // Check if the label is namespaced (contains a colon)
      if (label.includes(':')) {
        const namespace = label.split(':')[0];
        
        // Remove all existing labels with the same namespace
        // We need to fetch the current labels first to find matching ones
        const issue = await fetchIssueById(owner, repo, issueNumber, token);
        const currentLabels = issue.labels || [];
        
        // Normalize labels to strings
        const labelNames = currentLabels.map(l => typeof l === 'string' ? l : l.name || '');
        
        // Find and remove all labels with the same namespace
        for (const existingLabel of labelNames) {
          if (existingLabel.startsWith(`${namespace}:`)) {
            await removeIssueLabel(token, owner, repo, issueNumber, existingLabel);
          }
        }
      }
      
      // Add the new label
      await addIssueLabels(token, owner, repo, issueNumber, [label]);
      
      // Return 204 No Content on success
      return res.status(204).end();
    } catch (error) {
      const apiError = error instanceof Error ? error : null;
      const message = error instanceof Error ? error.message : String(error);
      return res.status(apiError?.statusCode || 500).json({
        error: "Failed to update label on GitHub.",
        details: apiError?.details || message,
      });
    }
  });
}