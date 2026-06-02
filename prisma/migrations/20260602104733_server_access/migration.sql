-- CreateTable
CREATE TABLE "ServerAccess" (
    "id" TEXT NOT NULL,
    "pteroUuid" TEXT NOT NULL,
    "serverIdentifier" TEXT NOT NULL,
    "serverUuid" TEXT NOT NULL,
    "serverName" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServerAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServerAccess_pteroUuid_idx" ON "ServerAccess"("pteroUuid");

-- CreateIndex
CREATE INDEX "ServerAccess_syncedAt_idx" ON "ServerAccess"("syncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ServerAccess_pteroUuid_serverIdentifier_key" ON "ServerAccess"("pteroUuid", "serverIdentifier");
