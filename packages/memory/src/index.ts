import { ulid } from "ulid";
import { z } from "zod";
import { isoDateTimeSchema, ulidSchema, type TrustedBusinessContext } from "@agentos/shared";

export const memorySchema = z.object({
  id: ulidSchema, businessId: ulidSchema, customerId: ulidSchema.optional(), conversationId: ulidSchema.optional(), type: z.string().min(1), content: z.string().min(1),
  importance: z.number().min(0).max(1), confidence: z.number().min(0).max(1), sourceMessageIds: z.array(ulidSchema), createdBy: z.string().min(1),
  validFrom: isoDateTimeSchema, expiresAt: isoDateTimeSchema.nullable(), supersededBy: ulidSchema.nullable(), createdAt: isoDateTimeSchema, updatedAt: isoDateTimeSchema,
});
export type Memory = z.infer<typeof memorySchema>;
export interface MemoryRepository {
  create(context: TrustedBusinessContext, memory: Memory): Promise<void>;
  get(context: TrustedBusinessContext, memoryId: string): Promise<Memory | null>;
  listActive(context: TrustedBusinessContext, filter: { customerId?: string; conversationId?: string }, at?: Date): Promise<Memory[]>;
  supersede(context: TrustedBusinessContext, memoryId: string, replacement: Memory): Promise<void>;
}

export class MemoryService {
  constructor(private readonly repository: MemoryRepository, private readonly clock: () => Date = () => new Date()) {}
  async remember(context: TrustedBusinessContext, input: Omit<Memory, "id" | "businessId" | "validFrom" | "supersededBy" | "createdAt" | "updatedAt">): Promise<Memory> {
    const now = this.clock().toISOString();
    const memory = memorySchema.parse({ ...input, id: ulid(), businessId: context.businessId, validFrom: now, supersededBy: null, createdAt: now, updatedAt: now });
    await this.repository.create(context, memory); return memory;
  }
  async update(context: TrustedBusinessContext, memoryId: string, changes: Pick<Memory, "content" | "importance" | "confidence">): Promise<Memory> {
    const current = await this.repository.get(context, memoryId); if (!current) throw new Error("Memory not found");
    const now = this.clock().toISOString();
    const replacement = memorySchema.parse({ ...current, ...changes, id: ulid(), validFrom: now, supersededBy: null, createdAt: now, updatedAt: now });
    await this.repository.supersede(context, memoryId, replacement); return replacement;
  }
  listActive(context: TrustedBusinessContext, filter: { customerId?: string; conversationId?: string }): Promise<Memory[]> { return this.repository.listActive(context, filter, this.clock()); }
}
