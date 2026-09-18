import { Entity } from './entity';

/** Consistency boundary: the root through which invariants across an aggregate are enforced. */
export abstract class AggregateRoot<Id, Props> extends Entity<Id, Props> {}
