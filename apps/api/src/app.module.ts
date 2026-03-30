import { Module } from "@nestjs/common";

import { HealthController } from "./health.controller";
import { AdminModule } from "./modules/admin/admin.module";
import { AuthModule } from "./modules/auth/auth.module";
import { FilesModule } from "./modules/files/files.module";
import { ProjectsModule } from "./modules/projects/projects.module";
import { QuotaModule } from "./modules/quota/quota.module";
import { SharedModule } from "./modules/shared/shared.module";

@Module({
  controllers: [HealthController],
  imports: [SharedModule, AuthModule, ProjectsModule, QuotaModule, FilesModule, AdminModule]
})
export class AppModule {}
