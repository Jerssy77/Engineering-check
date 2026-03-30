import { Global, Module } from "@nestjs/common";

import { AiReviewService } from "./ai-review.service";
import { DemoDataService } from "./demo-data.service";
import { FileBackedDataService } from "./file-backed-data.service";
import { PdfService } from "./pdf.service";

@Global()
@Module({
  providers: [
    FileBackedDataService,
    {
      provide: DemoDataService,
      useExisting: FileBackedDataService
    },
    AiReviewService,
    PdfService
  ],
  exports: [DemoDataService, FileBackedDataService, AiReviewService, PdfService]
})
export class SharedModule {}
