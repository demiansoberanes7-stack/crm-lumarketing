import { proxyActivities, sleep } from "@temporalio/workflow";
import type * as activities from "../activities/follow-up";

const { hasClientRepliedSince, triggerAiFollowUp } = proxyActivities<typeof activities>({
  startToCloseTimeout: "1 minute",
});

export async function followUpWorkflow(
  conversationId: string, 
  organizationId: string,
  delayHours: number = 72 // 3 days by default
): Promise<void> {
  const startDate = new Date().toISOString();
  
  // Wait for the specified delay
  await sleep(`${delayHours} hours`);
  
  // Check if client replied
  const replied = await hasClientRepliedSince(conversationId, startDate);
  
  // If they didn't reply, trigger the AI follow up
  if (!replied) {
    await triggerAiFollowUp(conversationId, organizationId);
  }
}
