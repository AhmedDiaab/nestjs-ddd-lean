import { ValidationError } from '@domain/errors';
import { Result } from '@shared';
import { ValueObject } from '../base';

export class TicketTitle extends ValueObject<{ value: string }> {
    static readonly MAX_LENGTH = 200;

    private constructor(value: string) {
        super({ value });
    }

    /** The only way to get a TicketTitle: invalid titles never exist. */
    static create(raw: string): Result<TicketTitle, ValidationError> {
        const value = raw.trim();
        if (!value) {
            return Result.err(new ValidationError({ title: 'Title is required' }));
        }
        if (value.length > TicketTitle.MAX_LENGTH) {
            return Result.err(
                new ValidationError({
                    title: `Title must be at most ${TicketTitle.MAX_LENGTH} characters`,
                }),
            );
        }
        return Result.ok(new TicketTitle(value));
    }

    get value(): string {
        return this.props.value;
    }
}
