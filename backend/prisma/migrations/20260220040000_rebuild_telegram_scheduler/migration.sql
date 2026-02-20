-- Drop legacy objects
DROP TABLE IF EXISTS "SentReminder" CASCADE;
DROP TABLE IF EXISTS "ProcessedUpdate" CASCADE;
DROP TABLE IF EXISTS "PendingAction" CASCADE;
DROP TABLE IF EXISTS "ConversationState" CASCADE;
DROP TABLE IF EXISTS "TherapistSettingsDraft" CASCADE;
DROP TABLE IF EXISTS "Appointment" CASCADE;
DROP TABLE IF EXISTS "TherapistSettings" CASCADE;
DROP TABLE IF EXISTS "Client" CASCADE;
DROP TABLE IF EXISTS "Task" CASCADE;

DROP TYPE IF EXISTS "PendingActionType";
DROP TYPE IF EXISTS "AppointmentStatus";
DROP TYPE IF EXISTS "AppointmentKind";
DROP TYPE IF EXISTS "TaskStatus";

-- New enums
CREATE TYPE "TaskStatus" AS ENUM ('active', 'boxed', 'completed', 'canceled');

-- New tables
CREATE TABLE "Task" (
  "id" TEXT NOT NULL,
  "chatId" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "important" BOOLEAN NOT NULL DEFAULT false,
  "emoji" TEXT NOT NULL DEFAULT '📝',
  "status" "TaskStatus" NOT NULL DEFAULT 'active',
  "dueAt" TIMESTAMP(3),
  "remindEveryMinutes" INTEGER,
  "nextReminderAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "canceledAt" TIMESTAMP(3),
  CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProcessedUpdate" (
  "id" TEXT NOT NULL,
  "chatId" TEXT NOT NULL,
  "updateId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProcessedUpdate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SentReminder" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "telegramMessageId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SentReminder_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "Task_chatId_status_idx" ON "Task"("chatId", "status");
CREATE INDEX "Task_chatId_dueAt_idx" ON "Task"("chatId", "dueAt");
CREATE INDEX "Task_chatId_nextReminderAt_idx" ON "Task"("chatId", "nextReminderAt");
CREATE UNIQUE INDEX "ProcessedUpdate_chatId_updateId_key" ON "ProcessedUpdate"("chatId", "updateId");
CREATE INDEX "ProcessedUpdate_createdAt_idx" ON "ProcessedUpdate"("createdAt");
CREATE UNIQUE INDEX "SentReminder_taskId_scheduledAt_key" ON "SentReminder"("taskId", "scheduledAt");
CREATE INDEX "SentReminder_scheduledAt_idx" ON "SentReminder"("scheduledAt");

-- Foreign keys
ALTER TABLE "SentReminder"
  ADD CONSTRAINT "SentReminder_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "Task"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
