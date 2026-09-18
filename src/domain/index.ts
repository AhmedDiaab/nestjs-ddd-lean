export { AggregateRoot, Entity, ValueObject } from './base';

export { AggregateNotFoundError, DomainError, ValidationError } from './errors';

export {
    type RepositoryOptions,
    type TicketRepository,
    TicketRepositoryToken,
} from './repositories';

export {
    Ticket,
    TicketAlreadyClosedError,
    type TicketProps,
    type TicketStatus,
    TicketTitle,
} from './tickets';
