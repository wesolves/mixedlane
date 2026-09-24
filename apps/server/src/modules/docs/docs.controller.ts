import { Controller, Delete, Get, HttpCode, Module, Param, ParseIntPipe, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiTags } from "@nestjs/swagger";
import { pageCreateSchema, pageMoveSchema, pageUpdateSchema, spaceCreateSchema, spaceUpdateSchema } from "@flowboard/shared";
import type { z } from "zod";
import { Ctx, type RequestContext } from "../../core/context";
import { ZBody } from "../../core/zod-body";
import { DocsService } from "./docs.service";

const OrgScoped = () => (target: object) => {
  ApiBearerAuth()(target as never);
  ApiHeader({ name: "X-Org", description: "Organization slug or id", required: true })(target as never);
};

@ApiTags("Docs")
@OrgScoped()
@Controller("spaces")
export class SpacesController {
  constructor(private readonly docs: DocsService) {}

  @Get()
  list(@Ctx() ctx: RequestContext) {
    return this.docs.listSpaces(ctx);
  }

  @Post()
  create(@Ctx() ctx: RequestContext, @ZBody(spaceCreateSchema) body: z.output<typeof spaceCreateSchema>) {
    return this.docs.createSpace(ctx, body);
  }

  @Get(":key")
  get(@Ctx() ctx: RequestContext, @Param("key") key: string) {
    return this.docs.getSpace(ctx, key);
  }

  @Patch(":key")
  update(@Ctx() ctx: RequestContext, @Param("key") key: string, @ZBody(spaceUpdateSchema) body: z.output<typeof spaceUpdateSchema>) {
    return this.docs.updateSpace(ctx, key, body);
  }

  @Delete(":key")
  @HttpCode(204)
  async remove(@Ctx() ctx: RequestContext, @Param("key") key: string) {
    await this.docs.deleteSpace(ctx, key);
  }

  /** The page tree (flat; nest by parentId, order by position). */
  @Get(":key/pages")
  tree(@Ctx() ctx: RequestContext, @Param("key") key: string) {
    return this.docs.tree(ctx, key);
  }

  @Post(":key/pages")
  createPage(@Ctx() ctx: RequestContext, @Param("key") key: string, @ZBody(pageCreateSchema) body: z.output<typeof pageCreateSchema>) {
    return this.docs.createPage(ctx, key, body);
  }
}

@ApiTags("Docs")
@OrgScoped()
@Controller("pages")
export class PagesController {
  constructor(private readonly docs: DocsService) {}

  @Get(":id")
  get(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.docs.detail(ctx, id);
  }

  /** Send the `baseVersion` you started editing from; 409 means someone saved in between. */
  @Patch(":id")
  update(@Ctx() ctx: RequestContext, @Param("id") id: string, @ZBody(pageUpdateSchema) body: z.output<typeof pageUpdateSchema>) {
    return this.docs.updatePage(ctx, id, body);
  }

  @Post(":id/move")
  @HttpCode(200)
  move(@Ctx() ctx: RequestContext, @Param("id") id: string, @ZBody(pageMoveSchema) body: z.output<typeof pageMoveSchema>) {
    return this.docs.movePage(ctx, id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    await this.docs.deletePage(ctx, id);
  }

  @Get(":id/versions")
  versions(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.docs.versions(ctx, id);
  }

  @Get(":id/versions/:version")
  version(@Ctx() ctx: RequestContext, @Param("id") id: string, @Param("version", ParseIntPipe) version: number) {
    return this.docs.version(ctx, id, version);
  }

  @Post(":id/versions/:version/restore")
  @HttpCode(200)
  restore(@Ctx() ctx: RequestContext, @Param("id") id: string, @Param("version", ParseIntPipe) version: number) {
    return this.docs.restore(ctx, id, version);
  }
}

@ApiTags("Docs")
@OrgScoped()
@Controller()
export class DocsLookupController {
  constructor(private readonly docs: DocsService) {}

  /** Full-text search across the pages you can read. Matches in the snippet are wrapped in «». */
  @Get("docs/search")
  search(@Ctx() ctx: RequestContext, @Query("q") q = "") {
    return this.docs.search(ctx, q);
  }

  /** Pages that mention this work item's key. */
  @Get("items/:id/pages")
  pagesForItem(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.docs.pagesForItem(ctx, id);
  }
}

@Module({
  controllers: [SpacesController, PagesController, DocsLookupController],
  providers: [DocsService],
  exports: [DocsService],
})
export class DocsModule {}
