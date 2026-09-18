import {
    CloseTicketUseCase,
    GetTicketUseCase,
    ListTicketsUseCase,
    OpenTicketUseCase,
} from '@application/use-cases';
import type { JWTPayload } from '@domain/auth';
import { CurrentUser, UseZodHttp, Validated } from '@interface/http/decorators';
import {
    closedTicketSchema,
    listTicketsQuerySchema,
    openTicketBodySchema,
    ticketIdParamsSchema,
    ticketIdSchema,
    ticketPageSchema,
    ticketSummarySchema,
    type ListTicketsQuery,
    type OpenTicketBody,
    type TicketIdParams,
} from '@interface/http/schemas';
import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from '../swagger';
import { BEARER_SECURITY } from '../swagger/swagger.constants';

/**
 * Thin controller: validate input, pass the authenticated user down, return the use-case Result.
 * ResponseFormatterInterceptor turns Result.ok into { success, data, meta } and
 * Result.err into the HTTP status of the error (404, 409, 422...).
 */
@ApiTags('tickets')
@ApiBearerAuth(BEARER_SECURITY)
@Controller('tickets')
export class TicketsController {
    constructor(
        private readonly openTicket: OpenTicketUseCase,
        private readonly closeTicket: CloseTicketUseCase,
        private readonly getTicket: GetTicketUseCase,
        private readonly listTickets: ListTicketsUseCase,
    ) {}

    @Post()
    @UseZodHttp({ body: openTicketBodySchema })
    @ZodResponse(201, ticketIdSchema, 'Ticket opened')
    open(@Validated('body') body: OpenTicketBody, @CurrentUser() user: JWTPayload) {
        return this.openTicket.execute({ title: body.title, username: user.username });
    }

    @Get()
    @UseZodHttp({ query: listTicketsQuerySchema })
    @ZodResponse(200, ticketPageSchema)
    list(@Validated('query') query: ListTicketsQuery, @CurrentUser() user: JWTPayload) {
        return this.listTickets.execute({
            filter: { status: query.status },
            page: { page: query.page, size: query.size, orderBy: query.orderBy },
            username: user.username,
        });
    }

    @Get(':id')
    @UseZodHttp({ params: ticketIdParamsSchema })
    @ZodResponse(200, ticketSummarySchema)
    get(@Validated('params') params: TicketIdParams, @CurrentUser() user: JWTPayload) {
        return this.getTicket.execute({ id: params.id, username: user.username });
    }

    @Post(':id/close')
    @HttpCode(HttpStatus.OK)
    @UseZodHttp({ params: ticketIdParamsSchema })
    @ZodResponse(200, closedTicketSchema, 'Ticket closed')
    close(@Validated('params') params: TicketIdParams, @CurrentUser() user: JWTPayload) {
        return this.closeTicket.execute({ id: params.id, username: user.username });
    }
}
