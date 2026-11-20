-- CTO-40: imported products arrive UNCLASSIFIED and are never sold until a
-- person classifies them (B5.5). Additive only. Kept in its own migration
-- because a new enum value cannot be used in the transaction that adds it.
ALTER TYPE "ProductFulfillmentClass" ADD VALUE IF NOT EXISTS 'UNCLASSIFIED';
