import express from "express";
import path from "node:path";
import dotenv from "dotenv";

// Load .env from the project root directory, not the current working directory
const projectDir = path.resolve(__dirname, "../../");
dotenv.config({ path: path.join(projectDir, ".env") });

import { registerCoreRoutes } from "./routes/coreRoutes";
import { registerAgentRoutes } from "./routes/agentRoutes";

const PORT = Number(process.env.PORT || 3000);
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "../../public")));

registerCoreRoutes(app);

registerAgentRoutes(app, projectDir);

app.listen(PORT, () => {
  console.log(`git-backlog-manager listening on http://localhost:${PORT}`);
});