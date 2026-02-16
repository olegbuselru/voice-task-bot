-- CreateTable
CREATE TABLE "TherapistSettingsDraft" (
    "id" TEXT NOT NULL,
    "telegramChatId" TEXT NOT NULL,
    "step" TEXT NOT NULL DEFAULT 'idle',
    "selectedDays" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "startTime" TEXT,
    "endTime" TEXT,
    "timezone" TEXT,
    "sessionMinutes" INTEGER,
    "bufferMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TherapistSettingsDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TherapistSettingsDraft_telegramChatId_key" ON "TherapistSettingsDraft"("telegramChatId");
