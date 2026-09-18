import {
    AccountGatewayToken,
    AccountQueryPortToken,
    DatabaseInfoQueryPortToken,
    TicketQueryPortToken,
} from '@application/ports';
import { ProviderFactory } from '@common/factories';
import { TicketRepositoryToken } from '@domain';
import {
    ConnectionProvider,
    ConnectionProviderToken,
    PoolManager,
} from '@infrastructure/database/connection';
import type { ConnectionProvider as IConnectionProvider } from '@infrastructure/database/contracts';
import { AccountApiGateway } from '@infrastructure/database/gateways';
import {
    AccountApiQueryDao,
    DatabaseInfoQueryDao,
    TicketQueryDao,
} from '@infrastructure/database/queries';
import { OracleTicketRepository } from '@infrastructure/database/repositories';
import { Global, Module } from '@nestjs/common';

@Global()
@Module({
    providers: [
        PoolManager,
        ConnectionProvider,
        // DAOs depend on ConnectionProviderToken (not PoolManager) so pools are
        // created and pinged before any DAO is constructed
        ProviderFactory.factory(
            DatabaseInfoQueryPortToken,
            (db: IConnectionProvider) => new DatabaseInfoQueryDao(db),
            [ConnectionProviderToken],
        ),
        ProviderFactory.factory(
            TicketRepositoryToken,
            (db: IConnectionProvider) => new OracleTicketRepository(db),
            [ConnectionProviderToken],
        ),
        ProviderFactory.factory(
            TicketQueryPortToken,
            (db: IConnectionProvider) => new TicketQueryDao(db),
            [ConnectionProviderToken],
        ),
        ProviderFactory.factory(
            AccountGatewayToken,
            (db: IConnectionProvider) => new AccountApiGateway(db),
            [ConnectionProviderToken],
        ),
        ProviderFactory.factory(
            AccountQueryPortToken,
            (db: IConnectionProvider) => new AccountApiQueryDao(db),
            [ConnectionProviderToken],
        ),
    ],
    exports: [
        ConnectionProviderToken,
        DatabaseInfoQueryPortToken,
        TicketRepositoryToken,
        TicketQueryPortToken,
        AccountGatewayToken,
        AccountQueryPortToken,
    ],
})
export class DatabaseModule {}
