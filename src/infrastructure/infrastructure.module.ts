import { AuthModule } from '@infrastructure/auth/auth.module';
import { ConfigModule } from '@infrastructure/config';
import { DatabaseModule } from '@infrastructure/database';
import { LifecycleModule } from '@infrastructure/lifecycle';
import { PinoLoggerModule } from '@infrastructure/logging';
import { Module } from '@nestjs/common';

/** Port implementations. Config, logging and database modules are global. */
@Module({
    imports: [ConfigModule, PinoLoggerModule, LifecycleModule, DatabaseModule, AuthModule],
    exports: [ConfigModule, PinoLoggerModule, LifecycleModule, DatabaseModule, AuthModule],
})
export class InfrastructureModule {}
