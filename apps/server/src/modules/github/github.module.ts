import { Module } from "@nestjs/common";
import { WorkModule } from "../work/work.module";
import { GithubController, ItemGithubController, ProjectGithubController } from "./github.controller";
import { GithubEvents } from "./github.events";
import { GithubService } from "./github.service";
import { GithubStore } from "./github.store";

@Module({
  imports: [WorkModule],
  controllers: [GithubController, ProjectGithubController, ItemGithubController],
  providers: [GithubStore, GithubEvents, GithubService],
})
export class GithubModule {}
