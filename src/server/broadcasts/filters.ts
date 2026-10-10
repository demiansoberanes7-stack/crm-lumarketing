import { z } from "zod";
import { MEDIUM_VALUES, SOCIAL_NETWORKS } from "@/lib/contact-medium";

export const broadcastFiltersSchema = z.object({
  stageId: z.string().trim().min(1).max(255).optional(),
  medium: z.enum(MEDIUM_VALUES).optional(),
  mediumDetail: z.enum(SOCIAL_NETWORKS).optional(),
  noteText: z.string().trim().min(1).max(160).optional(),
  noteDays: z.number().int().min(1).max(365).optional(),
}).strict();

export const createBroadcastSchema = z.object({
  name: z.string().trim().min(1).max(160),
  messageText: z.string().trim().min(1).max(4000),
  filters: broadcastFiltersSchema,
}).strict();

export type BroadcastFiltersInput = z.infer<typeof broadcastFiltersSchema>;
