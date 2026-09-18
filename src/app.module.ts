import { ApplicationModule } from '@application';
import { InfrastructureModule } from '@infrastructure';
import { InterfaceModule } from '@interface';
import { Module } from '@nestjs/common';

/**
 * Composition root: the only place where layers are wired together, and the only thing in it.
 * Infrastructure provides port implementations (global), application provides use cases,
 * interface exposes them over HTTP. Endpoints belong in `interface`, not here.
 */
@Module({
    imports: [InfrastructureModule, ApplicationModule, InterfaceModule],
})
export class AppModule {}
