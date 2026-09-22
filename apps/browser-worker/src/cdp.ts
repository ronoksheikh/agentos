type Reply = { id?: number; sessionId?: string; result?: Record<string, any>; error?: { message?: string }; method?: string; params?: Record<string, any> };
type Listener = (params: Record<string, any>, sessionId?: string) => void;

/** Small typed CDP transport; page code never runs in this process or sees its environment. */
export class Cdp {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: Record<string, any>) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      let reply: Reply;
      try { reply = JSON.parse(String(event.data)) as Reply; } catch { return; }
      if (reply.id) {
        const call = this.pending.get(reply.id); if (!call) return;
        this.pending.delete(reply.id); clearTimeout(call.timer);
        if (reply.error) call.reject(new Error("CDP_COMMAND_FAILED")); else call.resolve(reply.result ?? {});
      } else if (reply.method) for (const listener of this.listeners.get(reply.method) ?? []) listener(reply.params ?? {}, reply.sessionId);
    });
    socket.addEventListener("close", () => { for (const [id, call] of this.pending) { clearTimeout(call.timer); call.reject(new Error("CDP_DISCONNECTED")); this.pending.delete(id); } });
  }
  static async connect(url: string) {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP_CONNECT_TIMEOUT")), 5000);
      socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("CDP_CONNECT_FAILED")); }, { once: true });
    });
    return new Cdp(socket);
  }
  send(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeoutMs = 10_000): Promise<Record<string, any>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("CDP_COMMAND_TIMEOUT")); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  on(method: string, listener: Listener) { const set = this.listeners.get(method) ?? new Set<Listener>(); set.add(listener); this.listeners.set(method, set); return () => set.delete(listener); }
  close() { this.socket.close(); }
}
