import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { QuotaController } from "./quota.controller";
import { QuotaService } from "./quota.service";

@Module({
  imports: [AuthModule],
  controllers: [QuotaController],
  providers: [QuotaService],
  exports: [QuotaService]
})
export class QuotaModule {}
