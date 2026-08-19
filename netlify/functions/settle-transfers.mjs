import { settleDueTransfers } from './_lib/transfer-settlement.mjs';

export const config = { schedule: '*/5 * * * *' };

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});

export default async () => {
  try {
    const result = await settleDueTransfers({ limit: 20 });
    return json({ ok: true, ...result });
  } catch (error) {
    return json({ ok: false, error: error.message }, 503);
  }
};
