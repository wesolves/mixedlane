import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { AI_PROVIDERS, canHaveParent, itemCreateSchema, type MixdiChat, type MixdiSettingsInput, type MixdiAccess, type MixdiResult, type MixdiModelTestInput, type MixdiModelTestResult } from "@mixedlane/shared";
import { DB, type Db } from "../../core/database/database";
import { mixdiSettings, mixdiDrafts, mixdiConversations, orgMembers, projects, spaces, whatsappConnections } from "../../core/database/schema";
import type { RequestContext } from "../../core/context";
import { AppError } from "../../core/http";
import { markdownToHtml } from "../../core/markdown";
import { EventBus } from "../../core/events";
import { AccessService, requireOrg } from "../access/access.service";
import { DocsService } from "../docs/docs.service";
import { ItemsService } from "../work/items.service";
import { decrypt, encrypt } from "../github/crypto";
import { whatsappBootstrap } from "../whatsapp/bootstrap";
import type { ProviderConfig } from "../whatsapp/triage";
import { runMixdi } from "./workflow";
import { invokeMixdiProvider, MixdiProviderError } from "./provider";

const defaults = { enabled: false, providerMode: "shared" as const, userIds: [] as string[], createTickets: false, createDocuments: false, projectIds: [] as string[], spaceIds: [] as string[] };
@Injectable()
export class MixdiService {
  constructor(@Inject(DB) private readonly db: Db, private readonly access: AccessService, private readonly docs: DocsService, private readonly items: ItemsService, private readonly events: EventBus) {}
  private async config(orgId: string) {
    return (await this.db.select().from(mixdiSettings).where(eq(mixdiSettings.orgId, orgId)))[0];
  }
  private async sharedProviders(orgId: string): Promise<ProviderConfig> {
    const [shared] = await this.db.select().from(whatsappConnections).where(eq(whatsappConnections.orgId, orgId));
    return shared ? JSON.parse(decrypt(shared.providersEnc)) : whatsappBootstrap()?.providers ?? {};
  }
  private async dedicatedProviders(orgId: string, input?: MixdiSettingsInput["providers"]): Promise<ProviderConfig> {
    const row = await this.config(orgId);
    const previous: ProviderConfig = row ? JSON.parse(decrypt(row.providersEnc)) : {};
    return input ? Object.fromEntries(AI_PROVIDERS.map((p) => [p, { ...input[p], apiKey: input[p].apiKey ?? previous[p]?.apiKey ?? "" }])) : previous;
  }
  async testModels(ctx: RequestContext, input: MixdiModelTestInput): Promise<MixdiModelTestResult[]> {
    requireOrg(ctx, "org.manage");
    const providers = input.providerMode === "shared" ? await this.sharedProviders(ctx.orgId) : await this.dedicatedProviders(ctx.orgId, input.providers);
    const selected = input.provider ? [input.provider] : AI_PROVIDERS.filter((p) => providers[p]?.apiKey);
    if (!selected.length) throw new AppError(400, "Configure at least one provider before testing.");
    return Promise.all(selected.map(async (provider) => {
      const started = Date.now();
      const configuration = providers[provider] ?? { model: "", apiKey: "" };
      try {
        await invokeMixdiProvider(provider, configuration, 'This is a Mixdi model connectivity test. Return ONLY JSON with a short message and draft:null. Do not create or describe a ticket.', [{ role: "user", content: 'Reply with {"message":"Mixdi is ready","draft":null}.' }]);
        return { provider, model: configuration.model, ok: true, durationMs: Date.now() - started, message: "Connected. Mixdi JSON response validated." };
      } catch (error) {
        const failure = error instanceof MixdiProviderError ? error : new MixdiProviderError("provider_error");
        return { provider, model: configuration.model, ok: false, durationMs: Date.now() - started, category: failure.category, ...(failure.status ? { status: failure.status } : {}), message: failure.message };
      }
    }));
  }
  async settings(ctx: RequestContext) {
    requireOrg(ctx, "org.manage");
    const row = await this.config(ctx.orgId);
    const providers: ProviderConfig = row ? JSON.parse(decrypt(row.providersEnc)) : {};
    const shared = await this.sharedProviders(ctx.orgId);
    const info = (configs: ProviderConfig) => Object.fromEntries(AI_PROVIDERS.map((p) => [p, { model: configs[p]?.model ?? "", configured: !!configs[p]?.apiKey, ...(p === "custom" ? { url: configs[p]?.url ?? "" } : {}) }]));
    return { ...(row?.settings ?? defaults), providers: info(providers), sharedProviders: info(shared) };
  }
  async save(ctx: RequestContext, input: MixdiSettingsInput) {
    requireOrg(ctx, "org.manage");
    // Reject cross-organization grants and destination IDs.
    const checks = await Promise.all([
      input.userIds.length ? this.db.select({ id: orgMembers.userId }).from(orgMembers).where(and(eq(orgMembers.orgId, ctx.orgId), inArray(orgMembers.userId, input.userIds))) : [],
      input.projectIds.length ? this.db.select({ id: projects.id }).from(projects).where(and(eq(projects.orgId, ctx.orgId), inArray(projects.id, input.projectIds))) : [],
      input.spaceIds.length ? this.db.select({ id: spaces.id }).from(spaces).where(and(eq(spaces.orgId, ctx.orgId), inArray(spaces.id, input.spaceIds))) : [],
    ]);
    if (checks.some((list, i) => list.length !== new Set([input.userIds, input.projectIds, input.spaceIds][i]).size)) throw new AppError(400, "Choose users and destinations from this organization.");
    const providers = await this.dedicatedProviders(ctx.orgId, input.providers);
    for (const p of AI_PROVIDERS) if (providers[p]?.apiKey && (!providers[p]?.model || (p === "custom" && !providers[p]?.url))) throw new AppError(400, `Configure a model${p === "custom" ? " and URL" : ""} for ${p}.`);
    const { providers: _, ...settings } = input;
    const values = { orgId: ctx.orgId, settings, providersEnc: encrypt(JSON.stringify(providers)) };
    await this.db.insert(mixdiSettings).values(values).onConflictDoUpdate({ target: mixdiSettings.orgId, set: values });
    return this.settings(ctx);
  }
  async availability(ctx: RequestContext): Promise<MixdiAccess> {
    const settings = (await this.config(ctx.orgId))?.settings ?? defaults;
    return { allowed: !!ctx.userId && !ctx.agent && settings.enabled && settings.userIds.includes(ctx.userId), createTickets: settings.createTickets, createDocuments: settings.createDocuments, projectIds: settings.projectIds, spaceIds: settings.spaceIds };
  }
  private async authorize(ctx: RequestContext, input: Pick<MixdiChat, "kind" | "destination" | "parentId">) {
    ctx.accessCache?.clear();
    const a = await this.availability(ctx);
    if (!a.allowed) throw new AppError(403, "Your admin has not enabled Mixdi for you.");
    if (input.kind === "ticket") {
      if (!a.createTickets || !a.projectIds.includes(input.destination)) throw new AppError(403, "Mixdi cannot create tickets in this project.");
      const { project } = await this.access.project(ctx, input.destination, "item.create");
      if (input.parentId) await this.access.item(ctx, input.parentId, "project.read");
      const parent = input.parentId ? await this.items.get(ctx.orgId, input.parentId) : null;
      if (parent && parent.projectId !== project.id) throw new AppError(400, "Choose a parent in the selected project.");
      const enabledTypes = project.itemTypes.filter((t) => canHaveParent(t, parent?.type ?? null, project.itemTypes));
      if (!enabledTypes.length) throw new AppError(400, "This ticket cannot have children in the project's hierarchy. Choose another parent.");
      return { name: project.name, enabledTypes, parent: parent ? { id: parent.id, key: parent.key, title: parent.title, type: parent.type } : null };
    }
    if (!a.createDocuments || !a.spaceIds.includes(input.destination)) throw new AppError(403, "Mixdi cannot create documents in this space.");
    const { space } = await this.docs.space(ctx, input.destination, "write");
    const parent = input.parentId ? (await this.docs.page(ctx, input.parentId, "read")).page : null;
    if (parent && parent.spaceId !== space.id) throw new AppError(400, "Choose a parent in the selected space.");
    return { name: space.name, parent: parent ? { title: parent.title } : null };
  }
  private conversationScope(ctx: RequestContext, id?: string) {
    if (!ctx.userId || ctx.agent) throw new AppError(403, "Mixdi history requires a signed-in user.");
    return and(eq(mixdiConversations.orgId, ctx.orgId), eq(mixdiConversations.userId, ctx.userId), id ? eq(mixdiConversations.id, id) : undefined);
  }
  private async loadConversation(ctx: RequestContext, id: string) {
    const [row] = await this.db.select().from(mixdiConversations).where(this.conversationScope(ctx, id));
    if (!row) throw new AppError(404, "Conversation not found.");
    await this.authorize(ctx, row.context);
    return row;
  }
  async history(ctx: RequestContext) {
    if (!(await this.availability(ctx)).allowed) throw new AppError(403, "Your admin has not enabled Mixdi for you.");
    const rows = await this.db.select({ id: mixdiConversations.id, title: mixdiConversations.title, context: mixdiConversations.context, updatedAt: mixdiConversations.updatedAt }).from(mixdiConversations).where(this.conversationScope(ctx)).orderBy(desc(mixdiConversations.updatedAt)).limit(100);
    const visible = [];
    for (const row of rows) {
      try { await this.authorize(ctx, row.context); }
      catch (e) { if (e instanceof AppError && [400, 403, 404].includes(e.status)) continue; throw e; }
      visible.push({ id: row.id, title: row.title, ...row.context, updatedAt: row.updatedAt.toISOString() });
    }
    return visible;
  }
  async conversation(ctx: RequestContext, id: string) {
    const row = await this.loadConversation(ctx, id);
    const [draft] = row.draftId ? await this.db.select().from(mixdiDrafts).where(and(eq(mixdiDrafts.id, row.draftId), eq(mixdiDrafts.orgId, ctx.orgId), eq(mixdiDrafts.userId, ctx.userId!))) : [];
    return { id: row.id, title: row.title, ...row.context, updatedAt: row.updatedAt.toISOString(), messages: row.messages, reply: draft ? { message: row.messages.at(-1)?.content ?? "", draft: draft.draft, draftId: draft.id, conversationId: row.id } : null, result: draft?.result ?? null };
  }
  async removeConversation(ctx: RequestContext, id: string) {
    // Users may remove their own history even after destination access is revoked.
    const deleted = await this.db.delete(mixdiConversations).where(this.conversationScope(ctx, id)).returning({ id: mixdiConversations.id });
    if (!deleted.length) throw new AppError(404, "Conversation not found.");
  }
  async chat(ctx: RequestContext, input: MixdiChat) {
    const context = await this.authorize(ctx, input);
    const conversation = input.conversationId ? await this.loadConversation(ctx, input.conversationId) : undefined;
    if (conversation && (conversation.context.kind !== input.kind || conversation.context.destination !== input.destination || conversation.context.parentId !== input.parentId)) throw new AppError(400, "Start a new chat to change its destination or parent.");
    const messages = conversation ? [...conversation.messages, input.messages.at(-1)!] : input.messages;
    if (messages.length > 199) throw new AppError(409, "This conversation is full. Start a new chat.");
    const previousDraftId = conversation?.draftId ?? input.previousDraftId;
    let previousDraft;
    if (previousDraftId) {
      const [previous] = await this.db.select().from(mixdiDrafts).where(and(eq(mixdiDrafts.id, previousDraftId), eq(mixdiDrafts.orgId, ctx.orgId), eq(mixdiDrafts.userId, ctx.userId!)));
      if (!previous || previous.result || previous.request.kind !== input.kind || previous.request.destination !== input.destination || previous.request.parentId !== input.parentId) throw new AppError(400, "Choose a pending draft from this conversation's destination.");
      previousDraft = previous.draft;
    }
    const row = (await this.config(ctx.orgId))!;
    const providers = row.settings.providerMode === "shared" ? await this.sharedProviders(ctx.orgId) : JSON.parse(decrypt(row.providersEnc));
    const reply = await runMixdi({ ...input, messages: messages.slice(-29) }, { ...context, previousDraft }, providers);
    await this.authorize(ctx, input); // Permissions may change during provider latency.
    if (reply.draft && input.kind === "ticket" && "enabledTypes" in context && !context.enabledTypes?.includes(reply.draft.type)) throw new AppError(400, "Mixdi selected an invalid ticket type. Choose a valid parent or refine your request.");
    return this.db.transaction(async (tx) => {
      const request = { kind: input.kind, destination: input.destination, parentId: input.parentId };
      const [draft] = reply.draft ? await tx.insert(mixdiDrafts).values({ orgId: ctx.orgId, userId: ctx.userId!, request, draft: reply.draft }).returning() : [];
      const savedMessages = [...messages, { role: "assistant" as const, content: reply.message }];
      const values = { messages: savedMessages, draftId: draft?.id ?? conversation?.draftId ?? null, updatedAt: new Date(), version: (conversation?.version ?? 0) + 1 };
      const [saved] = conversation
        ? await tx.update(mixdiConversations).set(values).where(and(this.conversationScope(ctx, conversation.id), eq(mixdiConversations.version, conversation.version))).returning()
        : await tx.insert(mixdiConversations).values({ ...values, orgId: ctx.orgId, userId: ctx.userId!, title: messages[0].content.slice(0, 100), context: request }).returning();
      if (!saved) throw new AppError(409, "This chat changed in another window. Reopen it before sending again.");
      return { ...reply, draftId: draft?.id, conversationId: saved.id };
    });
  }
  async create(ctx: RequestContext, id: string): Promise<MixdiResult> {
    const scope = and(eq(mixdiDrafts.id, id), eq(mixdiDrafts.orgId, ctx.orgId), eq(mixdiDrafts.userId, ctx.userId ?? "00000000-0000-0000-0000-000000000000"));
    const [draft] = await this.db.select().from(mixdiDrafts).where(scope);
    if (!draft) throw new AppError(404, "Draft not found.");
    await this.authorize(ctx, draft.request);
    if (draft.result) return draft.result;
    if (Date.now() - draft.createdAt.getTime() > 86400000) throw new AppError(409, "Draft expired. Start a new chat.");
    // A renewable claim survives process crashes; its token fences stale writers at commit.
    const token = randomUUID();
    const [claimed] = await this.db.update(mixdiDrafts).set({ status: token, claimedAt: new Date() }).where(and(scope, isNull(mixdiDrafts.result), or(eq(mixdiDrafts.status, "pending"), lt(mixdiDrafts.claimedAt, new Date(Date.now() - 120000))))).returning();
    if (!claimed) throw new AppError(409, "Creation is already in progress. Refresh before retrying.");
    try {
      const { kind, destination, parentId } = draft.request;
      let result: MixdiResult;
      if (kind === "ticket") {
        const { project } = await this.access.project(ctx, destination, "item.create");
        const item = await this.db.transaction(async (tx) => {
          const item = await this.items.create(ctx.orgId, itemCreateSchema.parse({ ...draft.draft, projectId: destination, parentId }), ctx.actor, tx);
          result = { title: item.title, url: `/${ctx.orgSlug}/projects/${project.key}/${item.type}/${item.key}` };
          const saved = await tx.update(mixdiDrafts).set({ status: "created", result }).where(and(scope, eq(mixdiDrafts.status, token))).returning();
          if (!saved.length) throw new AppError(409, "This creation attempt expired. Retry the draft.");
          return item;
        });
        this.events.emit("item", { orgId: ctx.orgId, action: "created", item, actor: ctx.actor });
      } else {
        const { space } = await this.docs.space(ctx, destination, "write");
        await this.docs.createPage(ctx, destination, { title: draft.draft.title, contentHtml: markdownToHtml(draft.draft.description), parentId }, async (tx, page) => {
          result = { title: page.title, url: `/${ctx.orgSlug}/docs/${space.key}/${page.id}` };
          const saved = await tx.update(mixdiDrafts).set({ status: "created", result }).where(and(scope, eq(mixdiDrafts.status, token))).returning();
          if (!saved.length) throw new AppError(409, "This creation attempt expired. Retry the draft.");
        });
      }
      return result!;
    } catch (error) {
      await this.db.update(mixdiDrafts).set({ status: "pending", claimedAt: null }).where(and(scope, eq(mixdiDrafts.status, token)));
      throw error;
    }
  }
}
