import { Global, Module } from "@nestjs/common";

import { AiReviewService } from "./ai-review.service";
import { DemoDataService } from "./demo-data.service";
import { PdfService } from "./pdf.service";

@Global()
@Module({
  providers: [DemoDataService, AiReviewService, PdfService],
  exports: [DemoDataService, AiReviewService, PdfService]
})
export class SharedModule {}
