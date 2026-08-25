import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { InterviewsController } from "./interviews.controller";
import { GuidedAiSkillService } from "./guided-ai-skill.service";
import { InterviewsService } from "./interviews.service";

@Module({
  imports: [AuthModule],
  controllers: [InterviewsController],
  providers: [GuidedAiSkillService, InterviewsService],
  exports: [InterviewsService]
})
export class InterviewsModule {}
