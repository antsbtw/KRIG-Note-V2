import { Surreal } from 'surrealdb';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const { username, password } = JSON.parse(readFileSync(join(homedir(), 'Library/Application Support/KRIG Note V2/.db-credentials'), 'utf-8'));
const db = new Surreal(); await db.connect('ws://127.0.0.1:8533/rpc'); await db.signin({ username, password }); await db.use({ namespace: 'krig', database: 'krig_x' });
for (const q of process.argv.slice(2)) console.log(JSON.stringify(await db.query(q)));
await db.close();
