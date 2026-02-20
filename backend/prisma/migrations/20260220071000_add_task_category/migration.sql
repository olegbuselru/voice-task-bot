CREATE TYPE "TaskCategory" AS ENUM ('none', 'work', 'personal');

ALTER TABLE "Task"
  ADD COLUMN "category" "TaskCategory" NOT NULL DEFAULT 'none';
