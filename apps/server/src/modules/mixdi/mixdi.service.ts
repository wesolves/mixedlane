import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { AI_PROVIDERS, canHaveParent, itemCreateSchema, type MixdiChat, type MixdiSettingsInput, type MixdiAccess, type MixdiResult } from "@mixedlane/shared";
import { DB, type Db } from "../../core/database/database";
import { mixdiSettings, mixdiDrafts, orgMembers, projects, spaces, whatsappConnections } from "../../core/database/schema";
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

const defaults = { enabled: false, providerMode: "shared" as const, userIds: [] as string[], createTickets: false, createDocuments: false, projectIds: [] as string[], spaceIds: [] as string[] };
@Injectable()
export class MixdiService {
  constructor(@Inject(DB) private readonly db: Db, private readonly access: AccessService, private readonly docs: DocsService, private readonly items: ItemsService, private readonly events: EventBus) {}
  private async config(orgId: string) {
    return (await this.db.select().from(mixdiSettings).where(eq(mixdiSettings.orgId, orgId)))[0];
  }
  async settings(ctx: RequestContext) {
    requireOrg(ctx, "org.manage");
    const row = await this.config(ctx.orgId);
    const providers: ProviderConfig = row ? JSON.parse(decrypt(row.providersEnc)) : {};
    return { ...(row?.settings ?? defaults), providers: Object.fromEntries(AI_PROVIDERS.map((p) => [p, { model: providers[p]?.model ?? "", configured: !!providers[p]?.apiKey, ...(p === "custom" ? { url: providers[p]?.url ?? "" } : {}) }])) };
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
    const old = await this.config(ctx.orgId);
    const previous: ProviderConfig = old ? JSON.parse(decrypt(old.providersEnc)) : {};
    const providers: ProviderConfig = Object.fromEntries(AI_PROVIDERS.map((p) => [p, { ...input.providers[p], apiKey: input.providers[p].apiKey ?? previous[p]?.apiKey ?? "" }]));
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
      return { name: project.name, enabledTypes: project.itemTypes.filter((t) => canHaveParent(t, parent?.type ?? null, project.itemTypes)), parent: parent ? { title: parent.title, type: parent.type } : null };
    }
    if (!a.createDocuments || !a.spaceIds.includes(input.destination)) throw new AppError(403, "Mixdi cannot create documents in this space.");
    const { space } = await this.docs.space(ctx, input.destination, "write");
    const parent = input.parentId ? (await this.docs.page(ctx, input.parentId, "read")).page : null;
    if (parent && parent.spaceId !== space.id) throw new AppError(400, "Choose a parent in the selected space.");
    return { name: space.name, parent: parent ? { title: parent.title } : null };
  }
  async chat(ctx: RequestContext, input: MixdiChat) {
    const context = await this.authorize(ctx, input);
    let previousDraft;
    if (input.previousDraftId) {
      const [previous] = await this.db.select().from(mixdiDrafts).where(and(eq(mixdiDrafts.id, input.previousDraftId), eq(mixdiDrafts.orgId, ctx.orgId), eq(mixdiDrafts.userId, ctx.userId!)));
      if (!previous || previous.result || previous.request.kind !== input.kind || previous.request.destination !== input.destination || previous.request.parentId !== input.parentId) throw new AppError(400, "Choose a pending draft from this conversation's destination.");
      previousDraft = previous.draft;
    }
    const row = (await this.config(ctx.orgId))!;
    let providers: ProviderConfig;
    if (row.settings.providerMode === "shared") {
      const [shared] = await this.db.select().from(whatsappConnections).where(eq(whatsappConnections.orgId, ctx.orgId));
      providers = shared ? JSON.parse(decrypt(shared.providersEnc)) : whatsappBootstrap()?.providers ?? {};
    } else providers = JSON.parse(decrypt(row.providersEnc));
    const reply = await runMixdi(input, { ...context, previousDraft }, providers);
    await this.authorize(ctx, input); // Permissions may change during provider latency.
    if (!reply.draft) return reply;
    if (input.kind === "ticket" && "enabledTypes" in context && !context.enabledTypes?.includes(reply.draft.type)) throw new AppError(400, "Mixdi selected an invalid ticket type. Choose a valid parent or refine your request.");
    const [draft] = await this.db.insert(mixdiDrafts).values({ orgId: ctx.orgId, userId: ctx.userId!, request: { kind: input.kind, destination: input.destination, parentId: input.parentId }, draft: reply.draft }).returning();
    return { ...reply, draftId: draft.id };
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
