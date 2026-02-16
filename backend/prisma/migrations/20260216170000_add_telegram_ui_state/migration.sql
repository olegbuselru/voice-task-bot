-- CreateEnum
CREATE TYPE "PendingActionType" AS ENUM (
  'pick_slot',
  'confirm_cancel',
  'reschedule',
  'confirm_reschedule',
  'confirm_settings_save',
  'confirm_create_appointment'
);

-- CreateTable
CREATE TABLE "ConversationState" (
  "id" TEXT NOT NULL,
  "chatId" TEXT NOT NULL,
  "screen" TEXT NOT NULL,
  "step" TEXT NOT NULL,
  "payloadJson" JSONB,
  "screenMessageId" TEXT,
  "weekAnchor" TIMESTAMP(3),
  "dayIso" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConversationState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingAction" (
  "id" TEXT NOT NULL,
  "chatId" TEXT NOT NULL,
  "type" "PendingActionType" NOT NULL,
  "payloadJson" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PendingAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConversationState_chatId_key" ON "ConversationState"("chatId");

-- CreateIndex
CREATE INDEX "ConversationState_screen_idx" ON "ConversationState"("screen");

-- CreateIndex
CREATE INDEX "PendingAction_chatId_idx" ON "PendingAction"("chatId");

-- CreateIndex
CREATE INDEX "PendingAction_expiresAt_idx" ON "PendingAction"("expiresAt");

-- CreateIndex
CREATE INDEX "PendingAction_type_idx" ON "PendingAction"("type");
