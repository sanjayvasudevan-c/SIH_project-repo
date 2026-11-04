-- CreateTable
CREATE TABLE "AssignmentTrace" (
    "id" BIGSERIAL NOT NULL,
    "assignmentId" TEXT,
    "applicationId" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL,
    "chosenOfficerId" TEXT,
    "outcome" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "candidates" JSONB NOT NULL,
    "reasonText" TEXT NOT NULL,

    CONSTRAINT "AssignmentTrace_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssignmentTrace_applicationId_idx" ON "AssignmentTrace"("applicationId");

-- CreateIndex
CREATE INDEX "AssignmentTrace_decidedAt_idx" ON "AssignmentTrace"("decidedAt");
