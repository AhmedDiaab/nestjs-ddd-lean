import { Result } from '@shared';
import { AggregateRoot } from '../base';
import type { TicketTitle } from './ticket-title.vo';
import { TicketAlreadyClosedError } from './ticket.errors';

export type TicketStatus = 'open' | 'closed';

export type TicketProps = {
    title: TicketTitle;
    status: TicketStatus;
    createdBy: string;
    createdAt: Date;
    closedAt?: Date;
};

export class Ticket extends AggregateRoot<string, TicketProps> {
    private constructor(id: string, props: TicketProps) {
        super(id, props);
    }

    /** Business creation: applies rules and defaults. */
    static open(input: { id: string; title: TicketTitle; createdBy: string; now: Date }): Ticket {
        return new Ticket(input.id, {
            title: input.title,
            status: 'open',
            createdBy: input.createdBy,
            createdAt: input.now,
        });
    }

    /** Rehydration from storage: no rules, no events. Used by repository mappers only. */
    static restore(id: string, props: TicketProps): Ticket {
        return new Ticket(id, props);
    }

    close(closedBy: string, now: Date): Result<void, TicketAlreadyClosedError> {
        if (this.props.status === 'closed') {
            return Result.err(new TicketAlreadyClosedError(this.id));
        }
        this.props = { ...this.props, status: 'closed', closedAt: now };
        return Result.ok(undefined);
    }

    get title(): TicketTitle {
        return this.props.title;
    }
    get status(): TicketStatus {
        return this.props.status;
    }
    get createdBy(): string {
        return this.props.createdBy;
    }
    get createdAt(): Date {
        return this.props.createdAt;
    }
    get closedAt(): Date | undefined {
        return this.props.closedAt;
    }
}
