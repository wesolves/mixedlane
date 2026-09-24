import { Global, Inject, Logger, Module, type OnApplicationShutdown } from "@nestjs/common";
import { DB, openDatabase, type DatabaseHandle } from "./database";

const HANDLE = Symbol("DB_HANDLE");

@Global()
@Module({
  providers: [
    {
      provide: HANDLE,
      useFactory: async () => {
        const handle = await openDatabase();
        new Logger("Database").log(`Connected (${handle.driver})`);
        return handle;
      },
    },
    { provide: DB, useFactory: (h: DatabaseHandle) => h.db, inject: [HANDLE] },
  ],
  exports: [DB],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(HANDLE) private readonly handle: DatabaseHandle) {}

  async onApplicationShutdown() {
    await this.handle.close();
  }
}
