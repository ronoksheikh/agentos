import { createHash } from "node:crypto";
import { ulid } from "ulid";
import { z } from "zod";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { isoDateTimeSchema, ulidSchema, type TrustedBusinessContext } from "@agentos/shared";
import type { AgentTool, ToolExecutionContext } from "@agentos/tools";

export const knowledgeTypeSchema = z.enum(["PDF", "DOCX", "TEXT", "FAQ", "URL_SNAPSHOT", "CSV", "PRODUCT_CATALOG", "MANUAL_NOTE", "POLICY", "LIVE_DESCRIPTOR"]);
export const knowledgeStatusSchema = z.enum(["UPLOADED", "PROCESSING", "READY", "FAILED", "OUTDATED", "DISABLED", "DELETED"]);
export const knowledgeSourceSchema = z.object({ id: ulidSchema, businessId: ulidSchema, type: knowledgeTypeSchema, label: z.string().min(1).max(200), url: z.url().optional(), status: knowledgeStatusSchema, enabled: z.boolean(), version: z.number().int().positive(), checksum: z.string().length(64).nullable(), sizeBytes: z.number().int().nonnegative(), chunkCount: z.number().int().nonnegative(), errorCode: z.string().nullable(), retentionUntil: isoDateTimeSchema.nullable(), createdAt: isoDateTimeSchema, updatedAt: isoDateTimeSchema });
export type KnowledgeSource = z.infer<typeof knowledgeSourceSchema>;
export interface KnowledgeChunk { id: string; businessId: string; sourceId: string; sourceVersion: number; ordinal: number; content: string; terms: string[]; }
export interface KnowledgeHit { sourceId: string; sourceVersion: number; chunkId: string; label: string; type: KnowledgeSource["type"]; url?: string; excerpt: string; score: number; }
export interface KnowledgeRetriever { search(context: TrustedBusinessContext, query: string, filter?: { types?: KnowledgeSource["type"][]; sourceIds?: string[]; limit?: number }): Promise<KnowledgeHit[]>; }
export interface KnowledgeParser { parse(type: KnowledgeSource["type"], bytes: Uint8Array): Promise<string>; }

export class DefaultKnowledgeParser implements KnowledgeParser {
  async parse(type: KnowledgeSource["type"], bytes: Uint8Array): Promise<string> {
    if (bytes.byteLength > 10_000_000) throw new Error("SOURCE_TOO_LARGE");
    if (type === "PDF") { const parser = new PDFParse({ data: bytes }); try { return (await parser.getText()).text; } finally { await parser.destroy(); } }
    if (type === "DOCX") return (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value;
    const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (type === "CSV") return content.split(/\r?\n/).map((row) => row.split(",").map((cell) => cell.trim()).join(" | ")).join("\n");
    return content;
  }
}
const terms = (value: string) => [...new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])];
function chunksOf(content: string) { const words = content.replace(/\s+/g, " ").trim().split(" ").filter(Boolean); const chunks: string[] = []; for (let i = 0; i < words.length; i += 150) chunks.push(words.slice(i, i + 180).join(" ")); return chunks.slice(0, 500); }

/** Deterministic tenant-scoped adapter. PostgreSQL can replace the retriever without changing tool contracts. */
export class KnowledgeService implements KnowledgeRetriever {
  private readonly sources = new Map<string, KnowledgeSource>();
  private readonly chunks = new Map<string, KnowledgeChunk[]>();
  private readonly history = new Map<string, KnowledgeSource[]>();
  constructor(private readonly parser: KnowledgeParser = new DefaultKnowledgeParser(), private readonly clock: () => Date = () => new Date()) {}
  list(context: TrustedBusinessContext) { return [...this.sources.values()].filter((source) => source.businessId === context.businessId && source.status !== "DELETED").map((source) => structuredClone(source)); }
  get(context: TrustedBusinessContext, id: string) { const source = this.sources.get(id); return source?.businessId === context.businessId ? structuredClone(source) : null; }
  versions(context: TrustedBusinessContext, id: string) { return this.get(context, id) ? structuredClone(this.history.get(id) ?? []) : []; }
  async create(context: TrustedBusinessContext, input: { type: KnowledgeSource["type"]; label: string; bytes?: Uint8Array; url?: string; retentionUntil?: string }) {
    const now = this.clock().toISOString(); const source = knowledgeSourceSchema.parse({ id: ulid(), businessId: context.businessId, type: input.type, label: input.label, ...(input.url ? { url: input.url } : {}), status: "UPLOADED", enabled: true, version: 1, checksum: null, sizeBytes: 0, chunkCount: 0, errorCode: null, retentionUntil: input.retentionUntil ?? null, createdAt: now, updatedAt: now });
    this.sources.set(source.id, source); await this.process(context, source.id, input.bytes); return this.get(context, source.id)!;
  }
  async replace(context: TrustedBusinessContext, id: string, bytes?: Uint8Array) { const source = this.require(context, id); this.snapshot(source); source.version++; source.status = "OUTDATED"; source.updatedAt = this.clock().toISOString(); await this.process(context, id, bytes); return this.get(context, id)!; }
  async reprocess(context: TrustedBusinessContext, id: string, bytes?: Uint8Array) { return this.replace(context, id, bytes); }
  setEnabled(context: TrustedBusinessContext, id: string, enabled: boolean) { const source = this.require(context, id); source.enabled = enabled; source.status = enabled ? (source.chunkCount ? "READY" : "OUTDATED") : "DISABLED"; source.updatedAt = this.clock().toISOString(); return structuredClone(source); }
  delete(context: TrustedBusinessContext, id: string) { const source = this.require(context, id); this.snapshot(source); source.status = "DELETED"; source.enabled = false; source.updatedAt = this.clock().toISOString(); this.chunks.delete(id); }
  inspect(context: TrustedBusinessContext, id: string) { const source = this.require(context, id); return { source: structuredClone(source), chunks: structuredClone(this.chunks.get(id) ?? []) }; }
  private require(context: TrustedBusinessContext, id: string) { const source = this.sources.get(id); if (!source || source.businessId !== context.businessId || source.status === "DELETED") throw new Error("KNOWLEDGE_NOT_FOUND"); return source; }
  private snapshot(source: KnowledgeSource) { this.history.set(source.id, [...(this.history.get(source.id) ?? []), structuredClone(source)]); }
  private async process(context: TrustedBusinessContext, id: string, bytes?: Uint8Array) {
    const source = this.require(context, id); source.status = "PROCESSING"; source.errorCode = null; this.chunks.delete(id);
    try {
      if (source.type === "LIVE_DESCRIPTOR") { source.status = "READY"; return; }
      if (!bytes?.byteLength) throw new Error("EMPTY_SOURCE");
      const content = await this.parser.parse(source.type, bytes); if (!content.trim()) throw new Error("EMPTY_SOURCE");
      const pieces = chunksOf(content); source.checksum = createHash("sha256").update(bytes).digest("hex"); source.sizeBytes = bytes.byteLength; source.chunkCount = pieces.length;
      this.chunks.set(id, pieces.map((piece, ordinal) => ({ id: ulid(), businessId: context.businessId, sourceId: id, sourceVersion: source.version, ordinal, content: piece, terms: terms(piece) })));
      source.status = "READY";
    } catch (error) { source.status = "FAILED"; source.errorCode = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "PARSE_FAILED"; }
    finally { source.updatedAt = this.clock().toISOString(); }
  }
  async search(context: TrustedBusinessContext, query: string, filter: { types?: KnowledgeSource["type"][]; sourceIds?: string[]; limit?: number } = {}): Promise<KnowledgeHit[]> {
    const words = terms(query).slice(0, 20); if (!words.length) return [];
    const now = this.clock().getTime(); const hits: KnowledgeHit[] = [];
    for (const source of this.list(context)) {
      if (source.status !== "READY" || !source.enabled || (source.retentionUntil && Date.parse(source.retentionUntil) <= now) || filter.types && !filter.types.includes(source.type) || filter.sourceIds && !filter.sourceIds.includes(source.id)) continue;
      for (const chunk of this.chunks.get(source.id) ?? []) { const score = words.reduce((sum, word) => sum + (chunk.terms.includes(word) ? 1 : 0), 0); if (!score) continue; hits.push({ sourceId: source.id, sourceVersion: source.version, chunkId: chunk.id, label: source.label, type: source.type, ...(source.url ? { url: source.url } : {}), excerpt: chunk.content.slice(0, 700), score }); }
    }
    return hits.sort((a, b) => b.score - a.score || a.sourceId.localeCompare(b.sourceId)).slice(0, Math.min(filter.limit ?? 5, 20));
  }
}

const resultSchema = z.object({ results: z.array(z.object({ sourceId: ulidSchema, sourceVersion: z.number().int(), chunkId: ulidSchema, label: z.string(), type: knowledgeTypeSchema, url: z.string().optional(), excerpt: z.string(), score: z.number() })).max(20) });
export function createKnowledgeTools(retriever: KnowledgeRetriever): AgentTool[] {
  return ([{ name: "search_knowledge", types: undefined }, { name: "get_policy", types: ["POLICY"] }, { name: "search_faq", types: ["FAQ"] }] as const).map(({ name, types }) => ({ name, description: `${name}: attributed business knowledge; volatile stock, price and order state require live tools`, category: "knowledge" as const, safetyClass: "READ" as const, requiredCapabilities: ["knowledge.read"], inputSchema: z.object({ query: z.string().min(1).max(500), limit: z.number().int().min(1).max(10).default(5) }), outputSchema: resultSchema, redaction: { unsafeInputKeys: [], unsafeOutputKeys: [] }, async execute(context: ToolExecutionContext, input: { query: string; limit: number }) { const volatile = /\b(stock|inventory|live price|current price|order status)\b/i.test(input.query); return { results: volatile ? [] : await retriever.search(context, input.query, { ...(types ? { types: [...types] } : {}), limit: input.limit }) }; } }));
}
