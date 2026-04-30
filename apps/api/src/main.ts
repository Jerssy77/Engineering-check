import "reflect-metadata";

import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NextFunction, Request, Response } from "express";

import { AppModule } from "./app.module";
import { loadEnvFile } from "./load-env";

loadEnvFile();

const TENCENT_CLOUD_URL = "https://qualityai.cgr.com.cn";

function isRenderRuntime(): boolean {
  if (process.env.ALLOW_RENDER_RUNTIME === "true") {
    return false;
  }

  return [
    process.env.RENDER,
    process.env.RENDER_SERVICE_ID,
    process.env.RENDER_SERVICE_NAME,
    process.env.RENDER_EXTERNAL_URL,
    process.env.APP_DATA_FILE
  ].some((value) => value?.toLowerCase().includes("render"));
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    cors: true
  });

  if (isRenderRuntime()) {
    app.use((request: Request, response: Response, next: NextFunction) => {
      if (request.path === "/health") {
        next();
        return;
      }

      response.status(410).json({
        message: "Render 旧环境已停止使用，请访问腾讯云正式入口。",
        redirectUrl: TENCENT_CLOUD_URL
      });
    });
  }

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
