-- Add archived_at column to quote table for archive functionality
ALTER TABLE "quote" ADD COLUMN "archived_at" timestamp;
