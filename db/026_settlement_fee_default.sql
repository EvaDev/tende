-- Default merchant settlement fee to 1.5% (matches FX spread) for POC revenue tracking.
UPDATE app_config
   SET value = '150'
 WHERE key = 'revenue.settlement_fee_bps' AND value = '0';

-- Backfill fee columns on settlements that executed before fees were recorded.
UPDATE settlement_requests sr
   SET fee_bps = cfg.bps,
       fee_amount = ROUND(sr.amount * cfg.bps / 10000.0, 2),
       net_amount = ROUND(sr.amount - ROUND(sr.amount * cfg.bps / 10000.0, 2), 2)
  FROM (SELECT value::integer AS bps FROM app_config WHERE key = 'revenue.settlement_fee_bps') cfg
 WHERE sr.status = 'executed'
   AND sr.fee_amount IS NULL
   AND cfg.bps > 0;
