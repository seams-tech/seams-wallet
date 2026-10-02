// Local storage probe only. These raw SQL endpoints are never deployed.
async function fetch(request, env) {
  const input = await request.json();
  try {
    if (input.storage === 'd1') {
      const database = input.destination === 'source' ? env.SOURCE_DB : env.TARGET_DB;
      const statements = [];
      for (const statement of input.statements) {
        statements.push(database.prepare(statement.sql).bind(...statement.params));
      }
      return Response.json(await database.batch(statements));
    }
    const namespace = input.destination === 'source' ? env.SOURCE_DO : env.TARGET_DO;
    const id = namespace.idFromName(input.name);
    const stub = namespace.get(id, { locationHint: input.locationHint });
    return await stub.fetch(new Request('https://storage-probe.internal/', {
      method: 'POST',
      body: JSON.stringify(input.command),
    }));
  } catch (error) {
    return Response.json({ error: error.message }, { status: 409 });
  }
}

class StorageProbe {
  constructor(ctx) {
    this.ctx = ctx;
    this.volatileCalls = 0;
  }

  async fetch(request) {
    const command = await request.json();
    this.volatileCalls += 1;
    try {
      switch (command.kind) {
        case 'sql': {
          const results = this.ctx.storage.transactionSync(
            executeSql.bind(null, this.ctx.storage.sql, command.statements),
          );
          return Response.json(results);
        }
        case 'put':
          for (const [key, value] of command.entries) {
            await this.ctx.storage.put(key, value);
          }
          return Response.json({ stored: command.entries.length });
        case 'alarm':
          await this.ctx.storage.setAlarm(command.at);
          return Response.json({ alarmAt: await this.ctx.storage.getAlarm() });
        case 'inspect':
          return Response.json({
            id: this.ctx.id.toString(),
            kv: Array.from(await this.ctx.storage.list()),
            alarmAt: await this.ctx.storage.getAlarm(),
            volatileCalls: this.volatileCalls,
          });
        case 'delete_all':
          await this.ctx.storage.deleteAll();
          return Response.json({
            kv: Array.from(await this.ctx.storage.list()),
            alarmAt: await this.ctx.storage.getAlarm(),
          });
        default:
          throw new Error(`Unknown probe command: ${command.kind}`);
      }
    } catch (error) {
      return Response.json({ error: error.message }, { status: 409 });
    }
  }

  async alarm() {
    await this.ctx.storage.put('alarm-fired', true);
  }
}

function executeSql(sql, statements) {
  const results = [];
  for (const statement of statements) {
    results.push(sql.exec(statement.sql, ...statement.params).toArray());
  }
  return results;
}

export class SourceStorage extends StorageProbe {}
export class TargetStorage extends StorageProbe {}
export default { fetch };
