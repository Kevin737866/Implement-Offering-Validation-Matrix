import "dotenv/config";
import express, { NextFunction, Request, Response } from "express";
import morgan from "morgan";
import swaggerUi from "swagger-ui-express";
import { dbHealth, closePool } from "./db/client";
import { createCorsMiddleware } from "./middleware/cors";
import {
  createMilestoneValidationRouter,
  DomainEventPublisher,
  Milestone,
  MilestoneRepository,
  MilestoneValidationEvent,
  MilestoneValidationEventRepository,
  VerifierAssignmentRepository,
} from "./vaults/milestoneValidationRoute";

const app = express();
const port = process.env.PORT ?? 3000;

/**
 * @dev The global prefix applied to all business logic routers.
 * Defaults to `/api/v1` if `process.env.API_VERSION_PREFIX` is not supplied.
 * Crucial for preventing route conflict and ensuring reliable downstream tooling.
 */
const API_VERSION_PREFIX = process.env.API_VERSION_PREFIX ?? "/api/v1";
const apiRouter = express.Router();

/**
 * @notice Minimal OpenAPI document for secured API docs exposure.
 * @dev Keeps the route functional without expanding scope into full spec generation.
 */
const swaggerSpec = {
  openapi: "3.0.0",
  info: {
    title: "Revora Backend API",
    version: "1.0.0",
    description: "Backend API for Revora platform services.",
  },
  paths: {
    "/health": {
      get: {
        summary: "Health check endpoint",
        responses: {
          "200": {
            description: "Service is healthy",
          },
          "503": {
            description: "Service is degraded",
          },
        },
      },
    },
  },
};

class InMemoryMilestoneRepository implements MilestoneRepository {
  constructor(private readonly milestones = new Map<string, Milestone>()) {}

  private key(vaultId: string, milestoneId: string): string {
    return `${vaultId}:${milestoneId}`;
  }

  async getByVaultAndId(
    vaultId: string,
    milestoneId: string,
  ): Promise<Milestone | null> {
    return this.milestones.get(this.key(vaultId, milestoneId)) ?? null;
  }

  async markValidated(input: {
    vaultId: string;
    milestoneId: string;
    verifierId: string;
    validatedAt: Date;
  }): Promise<Milestone> {
    const key = this.key(input.vaultId, input.milestoneId);
    const current = this.milestones.get(key);

    if (!current) {
      throw new Error("Milestone not found");
    }

    const updated: Milestone = {
      ...current,
      status: "validated",
      validated_by: input.verifierId,
      validated_at: input.validatedAt,
    };

    this.milestones.set(key, updated);
    return updated;
  }
}

class InMemoryVerifierAssignmentRepository
  implements VerifierAssignmentRepository
{
  constructor(private readonly assignments = new Map<string, Set<string>>()) {}

  async isVerifierAssignedToVault(
    vaultId: string,
    verifierId: string,
  ): Promise<boolean> {
    return this.assignments.get(vaultId)?.has(verifierId) ?? false;
  }
}

class InMemoryMilestoneValidationEventRepository
  implements MilestoneValidationEventRepository
{
  private events: MilestoneValidationEvent[] = [];
  private counter = 0;

  async create(input: {
    vaultId: string;
    milestoneId: string;
    verifierId: string;
    createdAt: Date;
  }): Promise<MilestoneValidationEvent> {
    this.counter += 1;

    const event: MilestoneValidationEvent = {
      id: `validation-event-${this.counter}`,
      vault_id: input.vaultId,
      milestone_id: input.milestoneId,
      verifier_id: input.verifierId,
      created_at: input.createdAt,
    };

    this.events.push(event);
    return event;
  }
}

class ConsoleDomainEventPublisher implements DomainEventPublisher {
  async publish(
    eventName: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(`[domain-event] ${eventName}`, payload);
  }
}

const requireAuth = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const userId = req.header("x-user-id");
  const role = req.header("x-user-role");

  if (!userId || !role) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  (req as any).user = {
    id: userId,
    role,
  };

  next();
};

/**
 * @notice Protects API docs from unintended production exposure.
 * @dev Security assumptions:
 * - Docs are accessible by default outside production for developer usability.
 * - In production, docs are disabled unless explicitly enabled.
 * - If an access key is configured, clients must provide it using `x-api-docs-key`.
 * - Returning 404 when disabled reduces route discoverability.
 */
const protectApiDocs = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const isProduction = process.env.NODE_ENV === "production";
  const docsEnabled = process.env.ENABLE_API_DOCS === "true";
  const docsKey = process.env.API_DOCS_ACCESS_KEY;

  if (!isProduction) {
    next();
    return;
  }

  if (!docsEnabled) {
    res.status(404).json({ message: "Not found" });
    return;
  }

  if (docsKey) {
    const providedKey = req.header("x-api-docs-key");

    if (!providedKey || providedKey !== docsKey) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }
  }

  next();
};

const milestoneRepository = new InMemoryMilestoneRepository(
  new Map<string, Milestone>([
    [
      "vault-1:milestone-1",
      {
        id: "milestone-1",
        vault_id: "vault-1",
        status: "pending",
      },
    ],
  ]),
);

const verifierAssignmentRepository = new InMemoryVerifierAssignmentRepository(
  new Map<string, Set<string>>([["vault-1", new Set(["verifier-1"])]]),
);

const milestoneValidationEventRepository =
  new InMemoryMilestoneValidationEventRepository();

const domainEventPublisher = new ConsoleDomainEventPublisher();

app.use(createCorsMiddleware());
app.use(express.json());
app.use(morgan("dev"));

/**
 * @dev API documentation is intentionally mounted outside the versioned API router.
 * This keeps operational tooling separate from business endpoints while enforcing
 * explicit production access controls through `protectApiDocs`.
 */
app.use(
  "/api-docs",
  protectApiDocs,
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec),
);

/**
 * @dev All API business routes are deliberately scoped under the target version prefix.
 * This establishes an enforced boundary constraint preventing un-versioned fallback leaks.
 */
app.use(API_VERSION_PREFIX, apiRouter);

apiRouter.use(
  createMilestoneValidationRouter({
    requireAuth,
    milestoneRepository,
    verifierAssignmentRepository,
    milestoneValidationEventRepository,
    domainEventPublisher,
  }),
);

/**
 * @notice Operational route explicitly bypassing the API prefix boundary.
 * @dev Used generically by load balancers and orchestrators without coupling them to specific versions.
 */
app.get("/health", async (_req: Request, res: Response) => {
  const db = await dbHealth();

  res.status(db.healthy ? 200 : 503).json({
    status: db.healthy ? "ok" : "degraded",
    service: "revora-backend",
    db,
  });
});

apiRouter.get("/overview", (_req: Request, res: Response) => {
  res.json({
    name: "Stellar RevenueShare (Revora) Backend",
    description:
      "Backend API skeleton for tokenized revenue-sharing on Stellar (offerings, investments, revenue distribution).",
  });
});

const shutdown = async (signal: string) => {
  // eslint-disable-next-line no-console
  console.log(`\n[server] ${signal} DB shutting down…`);
  await closePool();
  process.exit(0);
};

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

if (process.env.NODE_ENV !== "test") {
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`revora-backend listening on http://localhost:${port}`);
  });
}

export default app;