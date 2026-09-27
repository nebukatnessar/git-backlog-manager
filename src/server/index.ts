import express, { type Request, type Response } from "express";
import path from "node:path";
import dotenv from "dotenv";

// Load .env from the project root directory, not the current working directory
const projectDir = path.resolve(__dirname, "../../");
dotenv.config({ path: path.join(projectDir, ".env") });

import { registerCoreRoutes } from "./routes/coreRoutes";
import { registerAgentRoutes } from "./routes/agentRoutes";
import { attachAuth, registerAuthRoutes, requireApiAuth } from "./auth";

const PORT = Number(process.env.PORT || 3000);
const app = express();

app.use(express.json());

app.use(express.static(path.join(__dirname, "../../public")));

// GitHub OAuth login (no-op when GITHUB_CLIENT_ID/GITHUB_CLIENT_SECRET are not set)
app.use(attachAuth);
registerAuthRoutes(app);
app.use(
  "/api",
  (req: Request, res: Response, next: () => void) => {
    // Endpoints reachable without signing in.
    const publicPaths = ["/api/health", "/api/config", "/api/auth/status"];
    if (publicPaths.some((p) => req.path === p)) return next();
    return requireApiAuth(req, res, next);
  },
);

registerCoreRoutes(app);
registerAgentRoutes(app, projectDir);

app.listen(PORT, () => {
  console.log(`git-backlog-manager listening on http://localhost:${PORT}`);
});