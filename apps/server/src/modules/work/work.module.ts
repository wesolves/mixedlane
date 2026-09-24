import { Module } from "@nestjs/common";
import { ActivityService } from "./activity.service";
import { CommentsService } from "./comments.service";
import { ItemsService } from "./items.service";
import { ProjectsService } from "./projects.service";
import { CommentsController, ItemsController, ProjectsController, SearchController } from "./work.controller";

@Module({
  controllers: [ProjectsController, ItemsController, CommentsController, SearchController],
  providers: [ProjectsService, ItemsService, CommentsService, ActivityService],
  exports: [ProjectsService, ItemsService, CommentsService, ActivityService],
})
export class WorkModule {}
