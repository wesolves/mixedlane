import { Inject, Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { AI_PROVIDERS, type ItemCreate, type WhatsappSettingsInput, type WhatsappSettingsInfo } from "@mixedlane/shared";
import { DB, type Db } from "../../core/database/database";
import { whatsappConnections as connections, whatsappSessions as sessions, whatsappContacts as contacts, whatsappDrafts as drafts, whatsappEvents as events, projects, workItems } from "../../core/database/schema";
import type { RequestContext } from "../../core/context";
import { EventBus } from "../../core/events";
import { AppError } from "../../core/http";
import { markdownToHtml } from "../../core/markdown";
import { JobsService } from "../../core/jobs/jobs.service";
import { config } from "../../core/config";
import { AccessService, requireOrg } from "../access/access.service";
import { ItemsService } from "../work/items.service";
import { decrypt, encrypt, randomSecret, verifySignature } from "../github/crypto";
import { OpenWaClient } from "./client";
import { triage, validateProposal, type ProviderConfig } from "./triage";
import { TriageFailure } from "./ai-diagnostics";
import { whatsappBootstrap } from "./bootstrap";

type Draft = typeof drafts.$inferSelect;
const scope = (orgId: string, id: string) => and(eq(drafts.orgId, orgId), eq(drafts.id, id));

@Injectable()
export class WhatsappService {
  constructor(@Inject(DB) private readonly db: Db, private readonly access: AccessService,
    private readonly items: ItemsService, private readonly jobs: JobsService, private readonly bus: EventBus) {
    jobs.register("whatsapp.incoming", async (p) => this.processEvent(String(p.id)));
    jobs.register("whatsapp.triage", async (p) => this.generate(String(p.orgId), String(p.id)));
    jobs.register("whatsapp.notify", async (p) => this.notify(String(p.orgId), String(p.id)));
  }

  async connection(orgId: string) {
    const [row] = await this.db.select().from(connections).where(eq(connections.orgId, orgId));
    if (!row) throw new AppError(400, "Configure WhatsApp first");
    return row;
  }
  async client(orgId: string) {
    const row = await this.connection(orgId);
    return new OpenWaClient(row.baseUrl, decrypt(row.apiKeyEnc));
  }
  async settings(orgId: string): Promise<WhatsappSettingsInfo> {
    const [row] = await this.db.select().from(connections).where(eq(connections.orgId, orgId));
    const bootstrap = row ? null : whatsappBootstrap();
    const providers: ProviderConfig | null = row ? JSON.parse(decrypt(row.providersEnc)) : bootstrap?.providers ?? null;
    return { configured: !!row, baseUrl: row?.baseUrl ?? bootstrap?.baseUrl ?? "http://192.168.0.6:2785", callbackUrl: row?.callbackUrl ?? config().PUBLIC_URL ?? config().APP_URL,
      defaultProjectId: row?.defaultProjectId ?? null, askProjectEveryTime: row?.askProjectEveryTime ?? true,
      hasApiKey: !!row || !!bootstrap?.apiKey, providers: Object.fromEntries(AI_PROVIDERS.map((p) => [p, { model: providers?.[p]?.model ?? "", configured: !!providers?.[p]?.apiKey, ...(p === "custom" ? { url: providers?.[p]?.url ?? "" } : {}) }])) as WhatsappSettingsInfo["providers"] };
  }
  async save(ctx: RequestContext, input: WhatsappSettingsInput) {
    requireOrg(ctx, "integration.manage");
    if (input.defaultProjectId) await this.access.project(ctx, input.defaultProjectId, "item.create");
    const [old] = await this.db.select().from(connections).where(eq(connections.orgId, ctx.orgId));
    const bootstrap = old ? null : whatsappBootstrap();
    const defaults = bootstrap?.baseUrl === input.baseUrl.replace(/\/$/, "") ? bootstrap : null;
    const previous: ProviderConfig | null = old ? JSON.parse(decrypt(old.providersEnc)) : defaults?.providers ?? null;
    const apiKey = input.apiKey || (old ? decrypt(old.apiKeyEnc) : defaults?.apiKey ?? "");
    if (!apiKey) throw new AppError(400, "An OpenWA API key is required");
    const callback = new URL(input.callbackUrl);
    if (!["http:", "https:"].includes(callback.protocol) || callback.username || callback.password || callback.search || callback.hash) throw new AppError(400, "Use an HTTP(S) callback base URL without credentials, query, or fragment");
    if (old && (old.baseUrl !== input.baseUrl.replace(/\/$/, "") || old.callbackUrl !== input.callbackUrl.replace(/\/$/, ""))) {
      const linked = await this.db.select().from(sessions).where(eq(sessions.orgId, ctx.orgId));
      if (linked.length) throw new AppError(409, "Remove connected accounts before changing gateway or callback URL");
    }
    await new OpenWaClient(input.baseUrl, apiKey).call("/sessions");
    const providers = Object.fromEntries(AI_PROVIDERS.map((p) => [p, { model: input.providers[p].model, apiKey: input.providers[p].apiKey ?? previous?.[p]?.apiKey ?? "", ...(p === "custom" ? { url: input.providers.custom.url ?? previous?.custom?.url ?? "" } : {}) }]));
    for (const p of AI_PROVIDERS) if (providers[p].apiKey && !providers[p].model) throw new AppError(400, `Choose a model for ${p}`);
    if (providers.custom.apiKey && !providers.custom.url) throw new AppError(400, "Enter a chat completions URL for the custom provider");
    const values = { defaultProjectId: input.defaultProjectId, askProjectEveryTime: input.askProjectEveryTime, baseUrl: input.baseUrl.replace(/\/$/, ""), callbackUrl: input.callbackUrl.replace(/\/$/, ""), apiKeyEnc: encrypt(apiKey), providersEnc: encrypt(JSON.stringify(providers)), webhookSecret: old?.webhookSecret ?? randomSecret() };
    await this.db.insert(connections).values({ orgId: ctx.orgId, ...values }).onConflictDoUpdate({ target: connections.orgId, set: values });
    return this.settings(ctx.orgId);
  }
  async session(ctx: RequestContext, id: string) {
    requireOrg(ctx, "integration.manage");
    const [row] = await this.db.select().from(sessions).where(and(eq(sessions.orgId, ctx.orgId), eq(sessions.id, id)));
    if (!row) throw new AppError(404, "WhatsApp account not found");
    return row;
  }
  async listSessions(ctx: RequestContext) {
    requireOrg(ctx, "integration.manage");
    const local = await this.db.select().from(sessions).where(eq(sessions.orgId, ctx.orgId));
    if (!local.length) return [];
    const client = await this.client(ctx.orgId);
    return Promise.all(local.map(async (s) => ({ ...(await client.call(`/sessions/${s.id}`)), id: s.id, defaultProjectId: s.defaultProjectId })));
  }
  async createSession(ctx: RequestContext, name: string) {
    requireOrg(ctx, "integration.manage");
    const client = await this.client(ctx.orgId);
    const remote = await client.call<{ id: string; name: string }>("/sessions", "POST", { name: `ml-${ctx.orgId.slice(0, 8)}-${name}` });
    await this.db.insert(sessions).values({ id: remote.id, name: remote.name, orgId: ctx.orgId });
    // Keep the local row if provisioning fails, so it can be retried or removed through the app.
    await this.startSession(ctx, remote.id);
    return remote;
  }
  async availableSessions(ctx: RequestContext) {
    requireOrg(ctx, "integration.manage");
    const linked = new Set((await this.db.select({ id: sessions.id }).from(sessions)).map((s) => s.id));
    const remote = await (await this.client(ctx.orgId)).call<any[]>("/sessions");
    return remote.filter((s) => !linked.has(s.id)).map((s) => ({ id: s.id, name: s.name, status: s.status, phone: s.phone }));
  }
  async linkSession(ctx: RequestContext, id: string) {
    requireOrg(ctx, "integration.manage");
    const remote = await (await this.client(ctx.orgId)).call(`/sessions/${id}`);
    await this.db.insert(sessions).values({ id, name: remote.name, orgId: ctx.orgId, managed: false }).onConflictDoNothing();
    await this.startSession(ctx, id);
    return { ok: true };
  }
  async startSession(ctx: RequestContext, id: string) {
    const local = await this.session(ctx, id);
    const client = await this.client(ctx.orgId);
    const conn = await this.connection(ctx.orgId);
    if (!local.webhookId) {
      const hook = await client.call<{ id: string }>(`/sessions/${id}/webhooks`, "POST", { url: `${conn.callbackUrl}/api/whatsapp/webhook/${ctx.orgId}/${id}`, events: ["message.received"], secret: conn.webhookSecret });
      await this.db.update(sessions).set({ webhookId: hook.id }).where(eq(sessions.id, id));
    }
    const remote = await client.call(`/sessions/${id}`);
    return remote.engineLoaded ? remote : client.call(`/sessions/${id}/start`, "POST");
  }
  async qr(ctx: RequestContext, id: string) {
    await this.session(ctx, id);
    return (await this.client(ctx.orgId)).call(`/sessions/${id}/qr`);
  }
  async removeSession(ctx: RequestContext, id: string) {
    const local = await this.session(ctx, id);
    const client = await this.client(ctx.orgId);
    if (local.webhookId) await client.call(`/sessions/${id}/webhooks/${local.webhookId}`, "DELETE");
    if (local.managed) await client.call(`/sessions/${id}`, "DELETE");
    await this.db.delete(sessions).where(and(eq(sessions.id, id), eq(sessions.orgId, ctx.orgId)));
    return { ok: true };
  }
  async listContacts(ctx: RequestContext) {
    requireOrg(ctx, "integration.manage");
    return this.db.select().from(contacts).where(eq(contacts.orgId, ctx.orgId));
  }
  async saveContact(ctx: RequestContext, phone: string, userId: string) {
    requireOrg(ctx, "integration.manage");
    if (!await this.access.contextFor(ctx.orgId, userId)) throw new AppError(400, "Choose a current organization member");
    return this.db.insert(contacts).values({ orgId: ctx.orgId, phone, userId }).onConflictDoUpdate({ target: [contacts.orgId, contacts.phone], set: { userId } }).returning();
  }
  async deleteContact(ctx: RequestContext, id: string) {
    requireOrg(ctx, "integration.manage");
    await this.db.delete(contacts).where(and(eq(contacts.orgId, ctx.orgId), eq(contacts.id, id)));
    return { ok: true };
  }
  async listDrafts(ctx: RequestContext) {
    const manage = ctx.orgPermissions.includes("integration.manage");
    const rows = await this.db.select().from(drafts).where(manage ? eq(drafts.orgId, ctx.orgId) : and(eq(drafts.orgId, ctx.orgId), eq(drafts.userId, ctx.userId!))).orderBy(desc(drafts.createdAt), desc(drafts.id));
    const visible: Draft[] = [];
    for (const d of rows) if (!d.projectId || await this.access.canRead(ctx, d.projectId)) visible.push(d);
    const itemIds = visible.flatMap((d) => d.itemId ? [d.itemId] : []);
    if (!itemIds.length) return visible;
    const linked = await this.db.select({ id: workItems.id, key: workItems.key, type: workItems.type, projectId: workItems.projectId, projectKey: projects.key }).from(workItems)
      .innerJoin(projects, eq(projects.id, workItems.projectId)).where(and(eq(workItems.orgId, ctx.orgId), inArray(workItems.id, itemIds)));
    const readable = new Map<string, boolean>();
    for (const item of linked) if (!readable.has(item.projectId)) readable.set(item.projectId, await this.access.canRead(ctx, item.projectId));
    const byId = new Map(linked.filter((i) => readable.get(i.projectId)).map((i) => [i.id, i]));
    return visible.map((d) => {
      const item = d.itemId ? byId.get(d.itemId) : undefined;
      return item ? { ...d, item: { key: item.key, type: item.type, projectKey: item.projectKey } } : d;
    });
  }
  async draft(orgId: string, id: string) {
    const [row] = await this.db.select().from(drafts).where(scope(orgId, id));
    if (!row) throw new AppError(404, "WhatsApp draft not found");
    return row;
  }
  async createTicket(ctx: RequestContext, id: string, input: ItemCreate) {
    const d = await this.draft(ctx.orgId, id);
    if (ctx.userId !== d.userId && !ctx.orgPermissions.includes("integration.manage")) throw new AppError(403, "Only the sender or an admin can create a ticket from this draft");
    const { project } = await this.access.project(ctx, input.projectId, "item.create");
    if (d.projectId && d.projectId !== project.id) throw new AppError(400, "Use the draft's selected project");
    if (input.parentId) await this.access.item(ctx, input.parentId, "project.read");
    const item = await this.db.transaction(async (tx) => {
      const [locked] = await tx.select().from(drafts).where(scope(ctx.orgId, id)).for("update");
      if (locked.status !== "failed" && locked.status !== "select_project") throw new AppError(409, "Only failed reports or reports awaiting a project can be created manually");
      if (locked.projectId && locked.projectId !== project.id) throw new AppError(409, "The draft's selected project changed. Reload before creating a ticket.");
      const created = await this.items.create(ctx.orgId, { ...input, projectId: project.id, labels: [...new Set([...(input.labels ?? []), "whatsapp"])] }, ctx.actor, tx);
      await tx.update(drafts).set({ projectId: project.id, status: "created", itemId: created.id, error: null }).where(scope(ctx.orgId, id));
      return created;
    });
    this.bus.emit("item", { orgId: ctx.orgId, action: "created", item, actor: ctx.actor });
    await this.jobs.enqueue("whatsapp.notify", { orgId: ctx.orgId, id }, { uniqueKey: `wa-result:${id}` });
    return item;
  }
  async review(ctx: RequestContext, id: string, action: "approve" | "cancel" | "retry") {
    const d = await this.draft(ctx.orgId, id);
    if (ctx.userId !== d.userId && !ctx.orgPermissions.includes("integration.manage")) throw new AppError(403, "Only the sender or an admin can review this draft");
    if (!d.projectId) throw new AppError(400, "Select a project in WhatsApp first");
    await this.access.project(ctx, d.projectId, "item.create");
    if (action === "retry") {
      const [changed] = await this.db.update(drafts).set({ status: "generating", error: null }).where(and(scope(ctx.orgId, id), eq(drafts.status, "failed"))).returning();
      if (!changed) throw new AppError(409, "Only failed drafts can be retried");
      await this.jobs.enqueue("whatsapp.triage", { orgId: ctx.orgId, id }, { uniqueKey: `wa-triage:${id}` });
      return changed;
    }
    let created: Awaited<ReturnType<ItemsService["create"]>> | null = null;
    const result = await this.db.transaction(async (tx) => {
      const [locked] = await tx.select().from(drafts).where(scope(ctx.orgId, id)).for("update");
      if (locked.status === "created" || locked.status === "cancelled") return locked;
      if (locked.status !== "review" || !locked.proposal) throw new AppError(409, "This draft is not ready for review");
      if (action === "cancel") {
        return (await tx.update(drafts).set({ status: "cancelled" }).where(scope(ctx.orgId, id)).returning())[0];
      }
      const project = (await tx.select().from(projects).where(and(eq(projects.orgId, ctx.orgId), eq(projects.id, locked.projectId!))))[0];
      if (!project) throw new AppError(404, "Project not found");
      const existing = await tx.select().from(workItems).where(and(eq(workItems.orgId, ctx.orgId), eq(workItems.projectId, project.id)));
      const p = validateProposal(locked.proposal, { report: locked.report, project, items: existing });
      if (p.duplicateId) throw new AppError(409, "AI found a possible duplicate. Revise the report before creating another ticket.");
      created = await this.items.create(ctx.orgId, { projectId: project.id, type: p.type, parentId: p.parentId, title: p.title, description: markdownToHtml(`${p.description}\n\n---\nReported through WhatsApp. Approved by ${ctx.actor.name}.`), priority: p.priority, labels: [p.category, "whatsapp"] }, { type: "system", id: null, name: `WhatsApp AI · approved by ${ctx.actor.name}` }, tx);
      return (await tx.update(drafts).set({ status: "created", itemId: created.id }).where(scope(ctx.orgId, id)).returning())[0];
    });
    if (created) this.bus.emit("item", { orgId: ctx.orgId, action: "created", item: created, actor: { type: "system", id: null, name: "WhatsApp AI" } });
    await this.jobs.enqueue("whatsapp.notify", { orgId: ctx.orgId, id }, { uniqueKey: `wa-result:${id}` });
    return result;
  }

  async receive(orgId: string, sessionId: string, raw: string, signature?: string) {
    const [conn] = await this.db.select().from(connections).where(eq(connections.orgId, orgId));
    if (!conn || !verifySignature(conn.webhookSecret, raw, signature)) throw new AppError(401, "Invalid WhatsApp webhook signature");
    const [session] = await this.db.select().from(sessions).where(and(eq(sessions.orgId, orgId), eq(sessions.id, sessionId)));
    if (!session) throw new AppError(404, "WhatsApp account not found");
    let body: any;
    try { body = JSON.parse(raw); } catch { throw new AppError(400, "Invalid JSON"); }
    if (body.sessionId !== sessionId) throw new AppError(400, "Session mismatch");
    if (body.event !== "message.received") return { ok: true };
    const data = body.data;
    if (!data || typeof data !== "object") throw new AppError(400, "Missing message data");
    const chatId = data.chatId ?? data.from;
    // Fail closed for groups, broadcasts, unknown identity formats, and outgoing messages.
    if (typeof chatId !== "string" || !/^\d{6,20}@(c\.us|s\.whatsapp\.net)$/.test(chatId) || data.isGroup === true || data.fromMe === true || data.direction === "outgoing") return { ok: true };
    const messageId = data.id ?? data.messageId ?? data.waMessageId;
    if (typeof messageId !== "string" || messageId.length > 500) throw new AppError(400, "Missing message ID");
    const eventKey = createHash("sha256").update(messageId).digest("hex");
    await this.db.insert(events).values({ orgId, sessionId, eventKey, payload: { ...data, chatId, messageId } }).onConflictDoNothing();
    const [event] = await this.db.select().from(events).where(and(eq(events.sessionId, sessionId), eq(events.eventKey, eventKey)));
    if (!event.processed) await this.jobs.enqueue("whatsapp.incoming", { id: event.id }, { uniqueKey: `wa-in:${event.id}` });
    return { ok: true };
  }

  async processEvent(id: string) {
    const [event] = await this.db.select().from(events).where(eq(events.id, id));
    if (!event || event.processed) return;
    if (await this.sender(event.orgId, String((event.payload as any).chatId))) {
      const client = await this.client(event.orgId);
      await client.whileTyping(event.sessionId, String((event.payload as any).chatId), () => this.handleMessage(event));
    }
    await this.db.update(events).set({ processed: true }).where(eq(events.id, id));
  }
  private async sender(orgId: string, chatId: string) {
    const phone = chatId.split("@")[0];
    const [mapped] = await this.db.select().from(contacts).where(and(eq(contacts.orgId, orgId), eq(contacts.phone, phone)));
    return mapped ? this.access.contextFor(orgId, mapped.userId) : null;
  }
  private async eligible(ctx: RequestContext) {
    const all = await this.db.select().from(projects).where(eq(projects.orgId, ctx.orgId));
    const allowed = [];
    for (const p of all) { try { await this.access.project(ctx, p.id, "item.create"); allowed.push(p); } catch {} }
    return allowed;
  }
  private async handleMessage(event: typeof events.$inferSelect) {
    const m = event.payload as any;
    const ctx = await this.sender(event.orgId, m.chatId);
    if (!ctx) return; // Unknown numbers never get project information or trigger AI.
    let text = String(m.button?.id ?? m.metadata?.button?.id ?? m.selectedButtonId ?? m.selectedRowId ?? m.metadata?.selectedButtonId ?? m.metadata?.selectedRowId ?? m.body ?? "").trim().slice(0, 12000);
    if (!text) return;
    const client = await this.client(event.orgId);
    // Commands run before quoted-report handling so a command never edits or creates a draft.
    const scopeCommand = /^\/scope(?:\s+([\s\S]*))?$/i.exec(text);
    const scopeSelection = /^scope:([0-9a-f-]{36})$/i.exec(text);
    const scopePage = /^scope-page:(\d{1,6})$/i.exec(text);
    if (scopeCommand || scopeSelection || scopePage) {
      const reply = (body: string) => client.text(event.sessionId, m.chatId, body, `wa-scope:${event.id}`, m.messageId);
      if (!ctx.userId || !["owner", "admin"].includes(ctx.orgRole) || !ctx.orgPermissions.includes("integration.manage")) {
        await reply("Only organization owners and admins can view or change the WhatsApp project scope.");
        return;
      }
      const [session] = await this.db.select().from(sessions).where(and(eq(sessions.orgId, ctx.orgId), eq(sessions.id, event.sessionId)));
      if (!session) return;
      const requested = scopeSelection?.[1] ?? scopeCommand?.[1]?.trim();
      if (!requested) {
        const available = await this.eligible(ctx);
        const conn = await this.connection(ctx.orgId);
        const selected = available.find((p) => p.id === (session.defaultProjectId ?? conn.defaultProjectId));
        const current = selected ? `${selected.key}: ${selected.name}${session.defaultProjectId ? " (this WhatsApp account)" : " (organization default)"}` : "No default; reports use the organization’s project-selection settings.";
        const pageSize = 8;
        const page = Math.min(Number(scopePage?.[1] ?? 0), Math.max(0, Math.ceil(available.length / pageSize) - 1));
        const rows = available.slice(page * pageSize, (page + 1) * pageSize).map((p) => ({ title: `${p.key}${p.id === selected?.id ? " (default)" : ""}: ${p.name}`.slice(0, 100), rowId: `scope:${p.id}` }));
        if (page > 0) rows.push({ title: "Previous projects", rowId: `scope-page:${page - 1}` });
        if ((page + 1) * pageSize < available.length) rows.push({ title: "More projects", rowId: `scope-page:${page + 1}` });
        if (!rows.length) { await reply("No projects are available for creating tickets."); return; }
        const description = `Current scope: ${current}\nSelect a project to make it the default for this WhatsApp account. Use /scope clear to return to organization settings.`;
        const fallback = `${description}\n\nReply with a command below:\n${rows.map((r) => `${r.title}\n${r.rowId}`).join("\n")}`;
        await client.interactive(event.sessionId, "send-list", { chatId: m.chatId, title: `Default project: ${selected?.key ?? "None"}`, description: description.slice(0, 1000), buttonText: "Projects", sections: [{ title: "Available projects", rows }] }, fallback, `wa-scope-list:${event.id}`, m.messageId);
        return;
      }
      if (/^clear$/i.test(requested)) {
        await this.db.update(sessions).set({ defaultProjectId: null }).where(and(eq(sessions.orgId, ctx.orgId), eq(sessions.id, session.id)));
        await reply("This WhatsApp account now uses the organization’s project-selection settings. Existing reports are unchanged.");
        return;
      }
      if (!scopeSelection && !/^[a-z][a-z0-9]{1,4}$/i.test(requested)) {
        await reply("Use /scope PROJECTCODE, /scope clear, or /scope to list projects.");
        return;
      }
      const selected = await this.access.project(ctx, requested, "item.create").catch(async (error: unknown) => {
        if (!(error instanceof AppError)) throw error;
        await reply("That project is unavailable or you cannot create tickets in it. Use /scope to list available projects.");
        return null;
      });
      if (!selected) return;
      await this.db.update(sessions).set({ defaultProjectId: selected.project.id }).where(and(eq(sessions.orgId, ctx.orgId), eq(sessions.id, session.id)));
      await reply(`Scope set to ${selected.project.key}: ${selected.project.name} for this WhatsApp account. Future reports use this project when the sender has access. A project code in a report overrides this default. Existing reports are unchanged.`);
      return;
    }
    // Quoted replies can approve, cancel, or refine the draft whose preview they answer.
    if (typeof m.quotedMessage?.id === "string") {
      const [quoted] = await this.db.select().from(drafts).where(and(eq(drafts.orgId, ctx.orgId), eq(drafts.sessionId, event.sessionId), eq(drafts.chatId, m.chatId), eq(drafts.userId, ctx.userId!), eq(drafts.previewMessageId, m.quotedMessage.id)));
      if (quoted?.status === "review" && !/^(approve|cancel|edit)[: ]/i.test(text)) {
        if (/^(approve|create|yes)$/i.test(text)) text = `approve:${quoted.id}`;
        else if (/^(cancel|no)$/i.test(text)) text = `cancel:${quoted.id}`;
        else text = `edit:${quoted.id} ${quoted.report}\n\nFollow-up: ${text}`;
      }
    }
    const review = /^(approve|cancel|edit)[: ]([0-9a-f-]{36})(?:\s+([\s\S]+))?$/i.exec(text);
    if (review) {
      const d = await this.draft(event.orgId, review[2]);
      if (ctx.userId !== d.userId && !ctx.orgPermissions.includes("integration.manage")) return;
      if (d.sessionId !== event.sessionId) return;
      if (review[1].toLowerCase() === "edit") {
        if (!review[3]) { await client.text(event.sessionId, m.chatId, `Reply with: edit ${d.id} followed by your corrected report.`, `wa-edit-help:${event.id}`, m.messageId); return; }
        if (!d.projectId) return;
        await this.access.project(ctx, d.projectId, "item.create");
        const [changed] = await this.db.update(drafts).set({ report: review[3], proposal: null, status: "generating", error: null }).where(and(scope(ctx.orgId, d.id), eq(drafts.status, "review"))).returning();
        if (changed) await this.jobs.enqueue("whatsapp.triage", { orgId: ctx.orgId, id: d.id }, { uniqueKey: `wa-triage:${d.id}` });
      } else {
        try { await this.review(ctx, d.id, review[1].toLowerCase() as "approve" | "cancel"); }
        catch (e) { if (!(e instanceof AppError)) throw e; await client.text(event.sessionId, m.chatId, e.message, `wa-review-error:${event.id}`, m.messageId); }
      }
      return;
    }
    const select = /^project:([0-9a-f-]{36}):([0-9a-f-]{36})$/i.exec(text);
    if (select) {
      const d = await this.draft(ctx.orgId, select[1]);
      if (d.userId !== ctx.userId || d.sessionId !== event.sessionId) return;
      await this.access.project(ctx, select[2], "item.create");
      const [changed] = await this.db.update(drafts).set({ projectId: select[2], status: "generating" }).where(and(scope(ctx.orgId, d.id), eq(drafts.status, "select_project"))).returning();
      if (changed) await this.jobs.enqueue("whatsapp.triage", { orgId: ctx.orgId, id: d.id }, { uniqueKey: `wa-triage:${d.id}` });
      return;
    }
    const available = await this.eligible(ctx);
    if (!available.length) return;
    const explicit = /^\/?([a-z][a-z0-9]{1,4})\s+([\s\S]+)$/i.exec(text);
    const explicitlyChosen = explicit ? available.find((p) => p.key === explicit[1].toUpperCase()) : null;
    const conn = await this.connection(ctx.orgId);
    const [account] = await this.db.select().from(sessions).where(and(eq(sessions.orgId, ctx.orgId), eq(sessions.id, event.sessionId)));
    const defaultProjectId = account?.defaultProjectId ?? conn.defaultProjectId;
    let remembered: typeof available[number] | undefined;
    if (!defaultProjectId && !conn.askProjectEveryTime) {
      const [previous] = await this.db.select({ projectId: drafts.projectId }).from(drafts).where(and(eq(drafts.orgId, ctx.orgId), eq(drafts.sessionId, event.sessionId), eq(drafts.chatId, m.chatId), eq(drafts.userId, ctx.userId!), isNotNull(drafts.projectId))).orderBy(desc(drafts.createdAt)).limit(1);
      remembered = available.find((p) => p.id === previous?.projectId);
    }
    const chosen = explicitlyChosen ?? available.find((p) => p.id === defaultProjectId) ?? remembered ?? (available.length === 1 ? available[0] : null);
    await this.db.insert(drafts).values({ orgId: ctx.orgId, sessionId: event.sessionId, messageId: m.messageId, chatId: m.chatId, userId: ctx.userId!, projectId: chosen?.id, report: explicitlyChosen && explicit ? explicit[2] : text, status: chosen ? "generating" : "select_project" }).onConflictDoNothing();
    const [draft] = await this.db.select().from(drafts).where(and(eq(drafts.sessionId, event.sessionId), eq(drafts.messageId, m.messageId)));
    if (chosen) { await this.jobs.enqueue("whatsapp.triage", { orgId: ctx.orgId, id: draft.id }, { uniqueKey: `wa-triage:${draft.id}` }); return; }
    const rows = available.slice(0, 10).map((p) => ({ title: `${p.key}: ${p.name}`.slice(0, 100), rowId: `project:${draft.id}:${p.id}` }));
    const fallback = `Choose a project by replying with one of these commands:\n${rows.map((r) => `${r.title}\n${r.rowId}`).join("\n")}\nYou can also send PROJECTCODE followed by the report.`;
    await client.interactive(event.sessionId, "send-list", { chatId: m.chatId, title: "Choose a project", description: "Where should this report go?", buttonText: "Projects", sections: [{ title: "Your projects", rows }] }, fallback, `wa-project:${draft.id}`, m.messageId);
  }

  async generate(orgId: string, id: string) {
    const d = await this.draft(orgId, id);
    if (d.status !== "generating" || !d.projectId) return;
    const client = await this.client(orgId);
    return client.whileTyping(d.sessionId, d.chatId, () => this.generateDraft(orgId, id));
  }
  private async generateDraft(orgId: string, id: string) {
    const d = await this.draft(orgId, id);
    if (d.status !== "generating" || !d.projectId) return;
    try {
      const ctx = await this.sender(orgId, d.chatId);
      if (!ctx || ctx.userId !== d.userId) throw new AppError(403, "Sender is no longer linked to a current member");
      const { project } = await this.access.project(ctx, d.projectId, "item.create");
      const existing = await this.db.select({ id: workItems.id, key: workItems.key, title: workItems.title, type: workItems.type, parentId: workItems.parentId }).from(workItems).where(and(eq(workItems.orgId, orgId), eq(workItems.projectId, project.id))).orderBy(desc(workItems.updatedAt)).limit(200);
      const conn = await this.connection(orgId);
      const { proposal, provider } = await triage({ report: d.report, project, items: existing }, JSON.parse(decrypt(conn.providersEnc)), { orgId, draftId: id });
      await this.db.update(drafts).set({ proposal, provider, status: "review", error: null }).where(and(scope(orgId, id), eq(drafts.status, "generating")));
    } catch (error) {
      await this.db.update(drafts).set({ status: "failed", error: error instanceof TriageFailure ? error.message : "Could not generate a valid draft. Check sender project access and integration configuration, then retry." }).where(and(scope(orgId, id), eq(drafts.status, "generating")));
    }
    await this.jobs.enqueue("whatsapp.notify", { orgId, id }, { uniqueKey: `wa-preview:${id}:${randomUUID()}` });
  }
  async notify(orgId: string, id: string) {
    const d = await this.draft(orgId, id);
    const ctx = await this.sender(orgId, d.chatId);
    if (!ctx || ctx.userId !== d.userId || !d.projectId || !await this.access.canRead(ctx, d.projectId)) return;
    const client = await this.client(orgId);
    if (d.status === "created" && d.itemId) {
      const item = await this.items.get(orgId, d.itemId);
      const [project] = await this.db.select().from(projects).where(eq(projects.id, item.projectId));
      await client.text(d.sessionId, d.chatId, `Created ${item.key}: ${item.title}\n${config().APP_URL}/${ctx.orgSlug}/projects/${project.key}/${item.type}/${item.key}`, `wa-created:${id}`, d.messageId);
    } else if (d.status === "review" && d.proposal) {
      const p = d.proposal;
      const preview = `${p.type.toUpperCase()} · ${p.category} · ${p.priority}\n${p.title}\n\n${p.description}\n\nWhy: ${p.reason}${p.duplicateId ? `\nPossible duplicate: ${p.duplicateId}. Edit the report before approving.` : ""}`.slice(0, 2900);
      const fallback = `${preview}\n\napprove ${id}\nedit ${id} <corrected report>\ncancel ${id}`;
      const sent = await client.interactive(d.sessionId, "send-buttons", { chatId: d.chatId, title: "Review your ticket", description: fallback, buttons: [{ type: "reply", displayText: "Create ticket", id: `approve:${id}` }, { type: "reply", displayText: "Edit report", id: `edit:${id}` }, { type: "reply", displayText: "Cancel", id: `cancel:${id}` }] }, fallback, `wa-preview:${id}:${createHash("sha256").update(JSON.stringify(p)).digest("hex").slice(0, 16)}`, d.messageId);
      if (sent?.messageId) await this.db.update(drafts).set({ previewMessageId: sent.messageId }).where(scope(orgId, id));
    } else if (d.status === "failed" || d.status === "cancelled") {
      await client.text(d.sessionId, d.chatId, d.status === "cancelled" ? "Report cancelled." : `Your report is saved, but AI could not prepare a ticket. Open the draft to retry or create a ticket manually: ${config().PUBLIC_URL ?? config().APP_URL}/${ctx.orgSlug}/ticket-drafts?draft=${id}`, `wa-${d.status}:${id}`, d.messageId);
    }
  }
}
