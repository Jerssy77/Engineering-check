import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { QuotaModule } from "../quota/quota.module";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";

@Module({
  imports: [AuthModule, QuotaModule],
  controllers: [AdminController],
  providers: [AdminService]
})
export class AdminModule {}
