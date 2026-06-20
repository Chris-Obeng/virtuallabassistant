-- CreateTable
CREATE TABLE "processed_webhooks" (
    "id" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_webhooks_pkey" PRIMARY KEY ("id")
);
