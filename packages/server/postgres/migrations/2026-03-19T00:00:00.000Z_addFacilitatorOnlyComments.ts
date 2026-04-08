import {Kysely} from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('MeetingSettings')
    .addColumn('facilitatorOnlyComments', 'boolean', (col) => col.notNull().defaultTo(false))
    .execute()
  await db.schema
    .alterTable('NewMeeting')
    .addColumn('facilitatorOnlyComments', 'boolean', (col) => col.notNull().defaultTo(false))
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('MeetingSettings').dropColumn('facilitatorOnlyComments').execute()
  await db.schema.alterTable('NewMeeting').dropColumn('facilitatorOnlyComments').execute()
}
