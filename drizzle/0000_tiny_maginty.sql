CREATE TYPE "public"."PositionSide" AS ENUM('LONG', 'SHORT');--> statement-breakpoint
CREATE TYPE "public"."ToolCallType" AS ENUM('CREATE_POSITION', 'CLOSE_POSITION');--> statement-breakpoint
CREATE TABLE "Invocations" (
	"id" text PRIMARY KEY NOT NULL,
	"modelId" text NOT NULL,
	"response" text NOT NULL,
	"responsePayload" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Models" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"openRoutermodelName" text NOT NULL,
	"lighterApiKey" text NOT NULL,
	"invocationCount" integer DEFAULT 0 NOT NULL,
	"totalMinutes" integer DEFAULT 0 NOT NULL,
	"accountIndex" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "PortfolioSize" (
	"id" text PRIMARY KEY NOT NULL,
	"modelId" text NOT NULL,
	"netPortfolio" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Positions" (
	"id" text PRIMARY KEY NOT NULL,
	"modelId" text NOT NULL,
	"symbol" text NOT NULL,
	"side" "PositionSide" NOT NULL,
	"quantity" numeric(20, 8) NOT NULL,
	"entryPrice" numeric(20, 8) NOT NULL,
	"leverage" numeric(10, 2),
	"confidence" numeric(5, 4),
	"exitPlan" jsonb,
	"toolCallId" text,
	"openedAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ToolCalls" (
	"id" text PRIMARY KEY NOT NULL,
	"invocationId" text NOT NULL,
	"toolCallType" "ToolCallType" NOT NULL,
	"metadata" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "Invocations" ADD CONSTRAINT "Invocations_modelId_Models_id_fk" FOREIGN KEY ("modelId") REFERENCES "public"."Models"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PortfolioSize" ADD CONSTRAINT "PortfolioSize_modelId_Models_id_fk" FOREIGN KEY ("modelId") REFERENCES "public"."Models"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Positions" ADD CONSTRAINT "Positions_modelId_Models_id_fk" FOREIGN KEY ("modelId") REFERENCES "public"."Models"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Positions" ADD CONSTRAINT "Positions_toolCallId_ToolCalls_id_fk" FOREIGN KEY ("toolCallId") REFERENCES "public"."ToolCalls"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ToolCalls" ADD CONSTRAINT "ToolCalls_invocationId_Invocations_id_fk" FOREIGN KEY ("invocationId") REFERENCES "public"."Invocations"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "Invocations_modelId_idx" ON "Invocations" USING btree ("modelId");--> statement-breakpoint
CREATE INDEX "Models_name_idx" ON "Models" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "Models_name_key" ON "Models" USING btree ("name");--> statement-breakpoint
CREATE INDEX "PortfolioSize_modelId_idx" ON "PortfolioSize" USING btree ("modelId");--> statement-breakpoint
CREATE INDEX "Positions_modelId_idx" ON "Positions" USING btree ("modelId");--> statement-breakpoint
CREATE INDEX "Positions_symbol_idx" ON "Positions" USING btree ("symbol");--> statement-breakpoint
CREATE UNIQUE INDEX "Positions_modelId_symbol_key" ON "Positions" USING btree ("modelId","symbol");--> statement-breakpoint
CREATE INDEX "ToolCalls_invocationId_idx" ON "ToolCalls" USING btree ("invocationId");