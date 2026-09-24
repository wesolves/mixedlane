import { EventEmitter } from "node:events";
import { Global, Injectable, Logger, Module } from "@nestjs/common";
import type { Actor } from "./context";
import type { comments, notifications, pages, workItems } from "./database/schema";

/**
 * In-process domain events, emitted by services *after* their transaction commits.
 * Consumers: the realtime gateway (pushes to sockets) and notifications.
 */
type ItemRow = typeof workItems.$inferSelect;
type CommentRow = typeof comments.$inferSelect;
type PageRow = typeof pages.$inferSelect;
type NotificationRow = typeof notifications.$inferSelect;

export interface ItemChanged {
  orgId: string;
  action: "created" | "updated" | "moved" | "deleted";
  item: ItemRow;
  /** State before the change (updates/moves). */
  prev?: ItemRow;
  actor: Actor;
}

export interface CommentChanged {
  orgId: string;
  action: "created" | "updated" | "deleted";
  item: ItemRow;
  comment: CommentRow;
  /** Body before an edit (to find newly added mentions). */
  prevBody?: string;
  actor: Actor;
}

export interface ProjectChanged {
  orgId: string;
  projectId: string;
  action: "updated" | "deleted" | "access";
  actor: Actor;
}

export interface PageChanged {
  orgId: string;
  action: "created" | "updated" | "moved" | "deleted";
  page: PageRow;
  prevHtml?: string;
  actor: Actor;
}

export interface SpaceChanged {
  orgId: string;
  spaceId: string;
  action: "created" | "updated" | "deleted";
  actor: Actor;
}

export interface NotificationCreated {
  notification: NotificationRow;
}

export interface DomainEvents {
  item: ItemChanged;
  comment: CommentChanged;
  project: ProjectChanged;
  page: PageChanged;
  space: SpaceChanged;
  notification: NotificationCreated;
}

type Handler<K extends keyof DomainEvents> = (event: DomainEvents[K]) => unknown;

/**
 * Tiny typed event bus. Handlers run asynchronously (never inside the caller's transaction or
 * request), and failures are logged instead of breaking the request that emitted the event.
 * `idle()` lets tests wait until every handler has finished.
 */
@Injectable()
export class EventBus {
  private readonly emitter = new EventEmitter().setMaxListeners(50);
  private readonly pending = new Set<Promise<unknown>>();
  private readonly log = new Logger("Events");

  on<K extends keyof DomainEvents>(name: K, handler: Handler<K>) {
    this.emitter.on(name, (event: DomainEvents[K]) => {
      const run = Promise.resolve()
        .then(() => handler(event))
        .catch((err) => this.log.error(`${name} handler failed: ${err instanceof Error ? err.stack : err}`))
        .finally(() => this.pending.delete(run));
      this.pending.add(run);
    });
  }

  emit<K extends keyof DomainEvents>(name: K, event: DomainEvents[K]) {
    this.emitter.emit(name, event);
  }

  /** Resolves once all handlers (including ones they trigger) have settled. */
  async idle() {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }
}

@Global()
@Module({ providers: [EventBus], exports: [EventBus] })
export class EventsModule {}
