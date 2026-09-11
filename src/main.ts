import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { ApiExceptionFilter } from './common/filters/api-exception.filter';
import { ApiResponseInterceptor } from './common/interceptors/api-response.interceptor';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  if (process.env.TRUST_PROXY === 'true') {
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
  }

  const corsOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  app.enableCors({
    origin: corsOrigins.length ? corsOrigins : true,
    credentials: true,
  });
  app.setGlobalPrefix('v1');
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    })
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(new ApiResponseInterceptor());

  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads/' });

  const config = new DocumentBuilder()
    .setTitle('Heros SOS API')
    .setDescription(
      'Authentication, contacts, location and SOS API for the Heros mobile app'
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'Token',
        description:
          'Paste the accessToken returned by password, email OTP or Google login.',
      },
      'bearer-token'
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  const port = process.env.PORT || 2155;
  await app.listen(port);

  Logger.log(`Swagger documentation: http://localhost:${port}/api-docs`);
  Logger.log(`Health check: http://localhost:${port}/v1/health`);
}

bootstrap();
