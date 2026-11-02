import { Body, Controller, Delete, Get, Headers, HttpCode, Module, Param, Post, Put, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { z } from "zod";
import { itemCreateSchema, whatsappSettingsSchema, type ItemCreate, type WhatsappSettingsInput } from "@mixedlane/shared";
import { Ctx, Public, type RequestContext } from "../../core/context";
import { ZodPipe } from "../../core/http";
import { requireOrg } from "../access/access.service";
import { WorkModule } from "../work/work.module";
import { WhatsappService } from "./whatsapp.service";

const accountSchema = z.object({ name: z.string().regex(/^[a-zA-Z0-9-]{3,25}$/) });
const contactSchema = z.object({ phone: z.string().regex(/^\+?\d{6,20}$/).transform((s) => s.replace(/^\+/, "")), userId: z.string().uuid() });
const reviewSchema = z.object({ action: z.enum(["approve", "cancel", "retry"]) });
const uuid = new ZodPipe(z.string().uuid());

@ApiTags("WhatsApp")
@ApiBearerAuth()
@Controller("whatsapp")
export class WhatsappController {
  constructor(private readonly wa: WhatsappService) {}
  @Get("settings")
  settings(@Ctx() ctx: RequestContext) { requireOrg(ctx, "integration.manage"); return this.wa.settings(ctx.orgId); }
  @Put("settings")
  save(@Ctx() ctx: RequestContext, @Body(new ZodPipe(whatsappSettingsSchema)) body: WhatsappSettingsInput) { return this.wa.save(ctx, body); }
  @Get("sessions")
  sessions(@Ctx() ctx: RequestContext) { return this.wa.listSessions(ctx); }
  @Post("sessions")
  create(@Ctx() ctx: RequestContext, @Body(new ZodPipe(accountSchema)) body: { name: string }) { return this.wa.createSession(ctx, body.name); }
  @Get("available-sessions")
  available(@Ctx() ctx: RequestContext) { return this.wa.availableSessions(ctx); }
  @Post("sessions/:id/link")
  link(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) { return this.wa.linkSession(ctx, id); }
  @Post("sessions/:id/start")
  start(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) { return this.wa.startSession(ctx, id); }
  @Get("sessions/:id/qr")
  qr(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) { return this.wa.qr(ctx, id); }
  @Delete("sessions/:id")
  remove(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) { return this.wa.removeSession(ctx, id); }
  @Get("contacts")
  contacts(@Ctx() ctx: RequestContext) { return this.wa.listContacts(ctx); }
  @Put("contacts")
  contact(@Ctx() ctx: RequestContext, @Body(new ZodPipe(contactSchema)) body: z.infer<typeof contactSchema>) { return this.wa.saveContact(ctx, body.phone, body.userId); }
  @Delete("contacts/:id")
  removeContact(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string) { return this.wa.deleteContact(ctx, id); }
  @Get("drafts")
  drafts(@Ctx() ctx: RequestContext) { return this.wa.listDrafts(ctx); }
  @Post("drafts/:id/review")
  review(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(reviewSchema)) body: z.infer<typeof reviewSchema>) { return this.wa.review(ctx, id, body.action); }
  @Post("drafts/:id/create-ticket")
  createTicket(@Ctx() ctx: RequestContext, @Param("id", uuid) id: string, @Body(new ZodPipe(itemCreateSchema)) body: ItemCreate) { return this.wa.createTicket(ctx, id, body); }
  @Public()
  @Post("webhook/:orgId/:sessionId")
  @HttpCode(202)
  webhook(@Param("orgId", uuid) orgId: string, @Param("sessionId", uuid) sessionId: string, @Req() req: Request & { rawBody?: Buffer }, @Headers("x-openwa-signature") signature?: string) {
    return this.wa.receive(orgId, sessionId, req.rawBody?.toString("utf8") ?? "", signature);
  }
}

@Module({ imports: [WorkModule], controllers: [WhatsappController], providers: [WhatsappService], exports: [WhatsappService] })
export class WhatsappModule {}
