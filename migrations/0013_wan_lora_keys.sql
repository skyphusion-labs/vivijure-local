-- Vivijure Local -- cast Wan LoRA keys (migration 0013).
--
-- A Wan 2.2 A14B character LoRA is a two-expert mixture (high-noise + low-noise), so it needs TWO
-- adapter keys beside the single-file lora_key. These columns are additive; lora_status,
-- lora_job_id, lora_error, and lora_trained_at stay SHARED with the SDXL path (a cast trains one
-- family at a time). Both NULL until a Wan train completes -- markWanLoraReady (vivijure-core
-- cast-db) sets them together. Pairs with @skyphusion-labs/vivijure-core Phase B (cf#29).

ALTER TABLE cast_members ADD COLUMN wan_lora_key_high TEXT;
ALTER TABLE cast_members ADD COLUMN wan_lora_key_low TEXT;
