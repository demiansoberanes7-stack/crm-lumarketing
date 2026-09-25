import { schema } from "@/lib/db";

export type TableEntry = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  orgColumn: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dateColumn: any;
};

export const TABLE_MAP: Record<string, TableEntry> = {
  messages: { table: schema.message, orgColumn: schema.message.organizationId, dateColumn: schema.message.createdAt },
  conversations: { table: schema.conversation, orgColumn: schema.conversation.organizationId, dateColumn: schema.conversation.createdAt },
  leads: { table: schema.lead, orgColumn: schema.lead.organizationId, dateColumn: schema.lead.createdAt },
  leadStageEvents: { table: schema.leadStageEvent, orgColumn: schema.leadStageEvent.organizationId, dateColumn: schema.leadStageEvent.createdAt },
  projects: { table: schema.project, orgColumn: schema.project.organizationId, dateColumn: schema.project.createdAt },
  projectStageEvents: { table: schema.projectStageEvent, orgColumn: schema.projectStageEvent.organizationId, dateColumn: schema.projectStageEvent.createdAt },
  projectTasks: { table: schema.projectTask, orgColumn: schema.projectTask.organizationId, dateColumn: schema.projectTask.createdAt },
  quotes: { table: schema.quote, orgColumn: schema.quote.organizationId, dateColumn: schema.quote.createdAt },
  quoteEvents: { table: schema.quoteEvent, orgColumn: schema.quoteEvent.organizationId, dateColumn: schema.quoteEvent.createdAt },
  charges: { table: schema.charge, orgColumn: schema.charge.organizationId, dateColumn: schema.charge.createdAt },
  payments: { table: schema.payment, orgColumn: schema.payment.organizationId, dateColumn: schema.payment.createdAt },
  expenses: { table: schema.expense, orgColumn: schema.expense.organizationId, dateColumn: schema.expense.createdAt },
  bookings: { table: schema.booking, orgColumn: schema.booking.organizationId, dateColumn: schema.booking.createdAt },
  offeredSlots: { table: schema.offeredSlot, orgColumn: schema.offeredSlot.organizationId, dateColumn: schema.offeredSlot.offeredAt },
  caltodoTasks: { table: schema.caltodoTask, orgColumn: schema.caltodoTask.organizationId, dateColumn: schema.caltodoTask.createdAt },
  outboundDeliveries: { table: schema.outboundDelivery, orgColumn: schema.outboundDelivery.organizationId, dateColumn: schema.outboundDelivery.createdAt },
  mediaAssets: { table: schema.mediaAsset, orgColumn: schema.mediaAsset.organizationId, dateColumn: schema.mediaAsset.createdAt },
  agentTestRuns: { table: schema.agentTestRun, orgColumn: schema.agentTestRun.organizationId, dateColumn: schema.agentTestRun.startedAt },
  agentTestCases: { table: schema.agentTestCase, orgColumn: schema.agentTestCase.organizationId, dateColumn: schema.agentTestCase.createdAt },
  emailMessages: { table: schema.emailMessage, orgColumn: schema.emailMessage.organizationId, dateColumn: schema.emailMessage.createdAt },
};
