import {
    CloseTicketUseCase,
    GetAccountBalanceUseCase,
    GetDatabaseInfoUseCase,
    GetTicketUseCase,
    ListAccountsUseCase,
    ListTicketsUseCase,
    OpenTicketUseCase,
    SuspendAccountUseCase,
} from '@application/use-cases';
import { Module } from '@nestjs/common';

const useCases = [
    SuspendAccountUseCase,
    GetAccountBalanceUseCase,
    ListAccountsUseCase,
    GetDatabaseInfoUseCase,
    OpenTicketUseCase,
    CloseTicketUseCase,
    GetTicketUseCase,
    ListTicketsUseCase,
];

/**
 * Use cases. Port implementations come from global infrastructure modules wired in the
 * composition root (`AppModule`), never imported here.
 */
@Module({
    providers: [...useCases],
    exports: [...useCases],
})
export class ApplicationModule {}
