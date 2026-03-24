import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import morgan from "morgan";
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

/**
 * Input Sanitization Middleware
 * 
 * Provides comprehensive input sanitization for all incoming request data
 * to prevent XSS attacks and injection vulnerabilities. This middleware
 * sanitizes request body, query parameters, and URL parameters.
 * 
 * @notice This middleware should be applied before route handlers
 * @dev Sanitizes string inputs by removing HTML tags and encoding special characters
 * @param req Express Request object
 * @param res Express Response object  
 * @param next Express NextFunction callback
 */
const inputSanitizerMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  /**
   * Sanitizes a string input by removing potentially dangerous content
   * 
   * @param input The string to sanitize
   * @returns The sanitized string
   */
  const sanitizeString = (input: string): string => {
    if (typeof input !== 'string') {
      return input;
    }

    return input
      // Remove HTML tags
      .replace(/<[^>]*>/g, '')
      // Encode special HTML characters
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;')
      // Remove potential JavaScript event handlers
      .replace(/on\w+\s*=/gi, '')
      // Remove javascript: protocol
      .replace(/javascript:/gi, '')
      // Trim whitespace
      .trim();
  };

  /**
   * Recursively sanitizes an object or array
   * 
   * @param obj The object or array to sanitize
   * @returns The sanitized object or array
   */
  const sanitizeRecursive = (obj: any): any => {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj === 'string') {
      return sanitizeString(obj);
    }

    if (Array.isArray(obj)) {
      return obj.map(sanitizeRecursive);
    }

    if (typeof obj === 'object') {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(obj)) {
        sanitized[key] = sanitizeRecursive(value);
      }
      return sanitized;
    }

    return obj;
  };

  // Sanitize request body
  if (req.body) {
    req.body = sanitizeRecursive(req.body);
  }

  // Sanitize query parameters
  if (req.query) {
    req.query = sanitizeRecursive(req.query);
  }

  // Sanitize URL parameters
  if (req.params) {
    req.params = sanitizeRecursive(req.params);
  }

  next();
};

// Export the middleware for testing
export { inputSanitizerMiddleware };

const app = express();
const port = process.env.PORT ?? 3000;
const API_VERSION_PREFIX = process.env.API_VERSION_PREFIX ?? '/api/v1';
const apiRouter = express.Router();

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

class InMemoryVerifierAssignmentRepository implements VerifierAssignmentRepository {
  constructor(private readonly assignments = new Map<string, Set<string>>()) {}

  async isVerifierAssignedToVault(
    vaultId: string,
    verifierId: string,
  ): Promise<boolean> {
    return this.assignments.get(vaultId)?.has(verifierId) ?? false;
  }
}

class InMemoryMilestoneValidationEventRepository implements MilestoneValidationEventRepository {
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

const requireAuth = (req: Request, res: Response, next: () => void): void => {
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
app.use(inputSanitizerMiddleware);
app.use(morgan("dev"));
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

app.get("/health", async (_req: Request, res: Response) => {
  const db = await dbHealth();
  res.status(db.healthy ? 200 : 503).json({
    status: db.healthy ? "ok" : "degraded",
    service: "revora-backend",
    db,
  });
});

app.get("/api/overview", (_req: Request, res: Response) => {
  res.json({
    name: "Stellar RevenueShare (Revora) Backend",
    description:
      "Backend API skeleton for tokenized revenue-sharing on Stellar (offerings, investments, revenue distribution).",
  });
});

const shutdown = async (signal: string) => {
  console.log(`\n[server] ${signal} DB shutting down…`);
  await closePool();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`revora-backend listening on http://localhost:${port}`);
});
