import "reflect-metadata";

import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { loadEnvFile } from "./load-env";

loadEnvFile();

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    cors: true
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true
    })
  );

  const port = Number(process.env.API_PORT ?? process.env.PORT ?? 3001);
  const host = process.env.API_HOST?.trim() || "0.0.0.0";

  await app.listen(port, host);

  const printableHost = host === "0.0.0.0" ? "localhost" : host;
  console.log(`[API] listening on http://${printableHost}:${port}`);
}

bootstrap();
