import { Worker, NativeConnection } from "@temporalio/worker";
import * as activities from "./activities/follow-up";
import { join } from "path";

async function run() {
  const address = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
  const connection = await NativeConnection.connect({ address });

  const worker = await Worker.create({
    connection,
    workflowsPath: join(__dirname, "workflows", "follow-up.ts"),
    activities,
    taskQueue: "crm-followups",
  });

  console.log("Starting Temporal Worker for Zorro Tech CRM…");
  await worker.run();
}

run().catch((err) => {
  console.error("Worker failed to start", err);
  process.exit(1);
});
