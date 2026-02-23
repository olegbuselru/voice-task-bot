-- Reset previous domain tables and keep only reminder bot storage
DROP TABLE IF EXISTS "SentReminder" CASCADE;
DROP TABLE IF EXISTS "TherapistSettingsDraft" CASCADE;
DROP TABLE IF EXISTS "TelegramUiState" CASCADE;
DROP TABLE IF EXISTS "Appointment" CASCADE;
DROP TABLE IF EXISTS "TherapistSettings" CASCADE;
DROP TABLE IF EXISTS "Client" CASCADE;
DROP TABLE IF EXISTS "Task" CASCADE;
DROP TABLE IF EXISTS "ProcessedUpdate" CASCADE;

DROP TYPE IF EXISTS "TaskCategory" CASCADE;
DROP TYPE IF EXISTS "TaskStatus" CASCADE;
DROP TYPE IF EXISTS "AppointmentStatus" CASCADE;
DROP TYPE IF EXISTS "AppointmentKind" CASCADE;
DROP TYPE IF EXISTS "SettingsWizardStep" CASCADE;
DROP TYPE IF EXISTS "ReminderStatus" CASCADE;

CREATE TYPE "ReminderStatus" AS ENUM ('scheduled', 'sent', 'canceled');

CREATE TABLE "Reminder" (
  "id" TEXT NOT NULL,
  "chatId" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "remindAt" TIMESTAMP(3) NOT NULL,
  "status" "ReminderStatus" NOT NULL DEFAULT 'scheduled',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProcessedUpdate" (
  "id" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProcessedUpdate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Reminder_status_remindAt_idx" ON "Reminder"("status", "remindAt");
CREATE INDEX "Reminder_chatId_status_idx" ON "Reminder"("chatId", "status");
CREATE INDEX "ProcessedUpdate_createdAt_idx" ON "ProcessedUpdate"("createdAt");
