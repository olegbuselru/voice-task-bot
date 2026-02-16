-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('planned', 'done', 'canceled');

-- CreateEnum
CREATE TYPE "AppointmentKind" AS ENUM ('session', 'homework', 'admin', 'other');

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'planned',
    "kind" "AppointmentKind" NOT NULL DEFAULT 'session',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TherapistSettings" (
    "id" TEXT NOT NULL,
    "telegramChatId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Bangkok',
    "workDays" TEXT[] DEFAULT ARRAY['mon', 'tue', 'wed', 'thu', 'fri']::TEXT[],
    "workStart" TEXT NOT NULL DEFAULT '10:00',
    "workEnd" TEXT NOT NULL DEFAULT '18:00',
    "sessionMinutes" INTEGER NOT NULL DEFAULT 50,
    "bufferMinutes" INTEGER NOT NULL DEFAULT 10,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TherapistSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Appointment_clientId_idx" ON "Appointment"("clientId");

-- CreateIndex
CREATE INDEX "Appointment_startAt_idx" ON "Appointment"("startAt");

-- CreateIndex
CREATE INDEX "Appointment_status_idx" ON "Appointment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TherapistSettings_telegramChatId_key" ON "TherapistSettings"("telegramChatId");

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_clientId_fkey"
FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
