import { Controller, Delete, Get, Module, Param, ParseUUIDPipe, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiTags } from "@nestjs/swagger";
import { mixdiChatSchema, mixdiSettingsSchema, mixdiModelTestSchema, type MixdiChat, type MixdiSettingsInput, type MixdiModelTestInput } from "@mixedlane/shared";
import { Ctx, type RequestContext } from "../../core/context";
import { ZBody } from "../../core/zod-body";
import { WorkModule } from "../work/work.module";
import { DocsModule } from "../docs/docs.controller";
import { MixdiService } from "./mixdi.service";

@ApiTags("Mixdi")
@ApiBearerAuth()
@ApiHeader({ name: "X-Org", required: true })
@Controller("mixdi")
export class MixdiController {
  constructor(private readonly mixdi: MixdiService) {}
  @Get("settings") settings(@Ctx() ctx: RequestContext) { return this.mixdi.settings(ctx); }
  @Put("settings") save(@Ctx() ctx: RequestContext, @ZBody(mixdiSettingsSchema) body: MixdiSettingsInput) { return this.mixdi.save(ctx, body); }
  @Post("settings/test") testModels(@Ctx() ctx: RequestContext, @ZBody(mixdiModelTestSchema) body: MixdiModelTestInput) { return this.mixdi.testModels(ctx, body); }
  @Get("access") access(@Ctx() ctx: RequestContext) { return this.mixdi.availability(ctx); }
  @Post("chat") chat(@Ctx() ctx: RequestContext, @ZBody(mixdiChatSchema) body: MixdiChat) { return this.mixdi.chat(ctx, body); }
  @Get("conversations") history(@Ctx() ctx: RequestContext) { return this.mixdi.history(ctx); }
  @Get("conversations/:id") conversation(@Ctx() ctx: RequestContext, @Param("id", ParseUUIDPipe) id: string) { return this.mixdi.conversation(ctx, id); }
  @Delete("conversations/:id") removeConversation(@Ctx() ctx: RequestContext, @Param("id", ParseUUIDPipe) id: string) { return this.mixdi.removeConversation(ctx, id); }
  @Post("drafts/:id/create") create(@Ctx() ctx: RequestContext, @Param("id", ParseUUIDPipe) id: string) { return this.mixdi.create(ctx, id); }
}
@Module({ imports: [WorkModule, DocsModule], controllers: [MixdiController], providers: [MixdiService] })
export class MixdiModule {}
