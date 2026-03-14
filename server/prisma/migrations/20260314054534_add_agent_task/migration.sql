-- CreateTable
CREATE TABLE "AgentTask" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "plan" JSONB NOT NULL,
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "stepResults" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'planning',
    "finalOutput" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentTask_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
