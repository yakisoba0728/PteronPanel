-- AlterTable
ALTER TABLE "ServerAccess" ADD COLUMN     "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
