const fs = require('fs');
const path = require('path');
const assert = require('assert');

const sql = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20260905b_fix_alpha_update_subject_trigger_table_fields.sql'),
  'utf8'
);

assert.match(sql, /if tg_table_name = 'manager_messages' then[\s\S]*new\.message_type <> 'alpha_update'/i);
assert.match(sql, /elsif tg_table_name = 'world_feed_items' then[\s\S]*new\.item_type <> 'alpha_update'/i);
assert.doesNotMatch(sql, /tg_table_name = 'manager_messages' and new\.message_type/i);
assert.doesNotMatch(sql, /tg_table_name = 'world_feed_items' and new\.item_type/i);

console.log('alphaUpdateSubjectTriggerTableFields.test.js passed');
