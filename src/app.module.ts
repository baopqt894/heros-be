import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';

import { UsersModule } from './modules/users/users.module';
import { AuthGuard } from './common/guards/auth.guard';
import { AuthModule } from './modules/auth/auth.module';
import { EmergencyContactsModule } from './modules/emergency-contacts/emergency-contacts.module';
import { DevicesModule } from './modules/devices/devices.module';
import { SosModule } from './modules/sos/sos.module';
import { HealthController } from './modules/health/health.controller';
import { HardwareDevicesModule } from './modules/hardware-devices/hardware-devices.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (config: Record<string, unknown>) => {
        const required = [
          'MONGODB_URI',
          'JWT_ACCESS_SECRET',
          'OTP_HASH_SECRET',
        ];
        for (const name of required) {
          if (typeof config[name] !== 'string' || !config[name]) {
            throw new Error(`${name} is required`);
          }
        }
        for (const name of ['JWT_ACCESS_SECRET', 'OTP_HASH_SECRET']) {
          if ((config[name] as string).length < 32) {
            throw new Error(`${name} must contain at least 32 characters`);
          }
        }
        return config;
      },
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const uri = config.get<string>('MONGODB_URI');
        if (!uri) throw new Error('MONGODB_URI is required');
        return {
          uri,
          retryAttempts: 5,
          retryDelay: 3000,
          serverSelectionTimeoutMS: 10000,
          connectTimeoutMS: 10000,
        };
      },
    }),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_ACCESS_SECRET');
        if (!secret) throw new Error('JWT_ACCESS_SECRET is required');
        return {
          secret,
          signOptions: {
            expiresIn: (config.get<string>('JWT_ACCESS_TTL') || '15m') as any,
          },
        };
      },
    }),
    UsersModule,
    AuthModule,
    EmergencyContactsModule,
    DevicesModule,
    HardwareDevicesModule,
    SosModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
})
export class AppModule {}
