-- CreateTable
CREATE TABLE "EngineRun" (
    "id" BIGSERIAL NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "instanceId" TEXT NOT NULL,
    "simulatedToday" DATE NOT NULL,
    "provenance" TEXT NOT NULL,
    "itemsChecked" INTEGER NOT NULL DEFAULT 0,
    "alertsCreated" INTEGER NOT NULL DEFAULT 0,
    "alertsSuppressed" INTEGER NOT NULL DEFAULT 0,
    "notifications" INTEGER NOT NULL DEFAULT 0,
    "flagsRaised" INTEGER NOT NULL DEFAULT 0,
    "escalations" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "error" TEXT,

    CONSTRAINT "EngineRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EngineRun_startedAt_idx" ON "EngineRun"("startedAt");

-- CreateIndex
CREATE INDEX "EngineRun_status_idx" ON "EngineRun"("status");
