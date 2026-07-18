# Changelog


## Unreleased

### Changed
- **The model catalog is now fully projected from installed modules.** `GET /api/models` builds both
  its planning rows (from `plan.enhance` modules) and its image rows (from the new `image.generate`
  modules) by asking what each installed module declares. The studio hardcodes no model names at
  all. `src/image-models.ts` is deleted; `POST /api/chat` dispatches image generation to the module
  that declared the chosen model. (cf#129 phase 2)

### Fixed
- **Chat image previews 404'd when a separate chat bucket was configured** (vivijure-cf#140). Chat
  artifacts were written to `chatBucket` while `GET /api/artifact` only ever served the main bucket,
  so a successful generation produced an unservable artifact with no error anywhere. Artifacts are
  now written to the store that serves them, and the write/serve split can no longer be expressed.

### Removed
- **BREAKING (response shape): `GET /api/models` rows no longer carry a `provider` field.** Shipped
  in v1.0.x, removed here. The field named which provider the studio would dispatch a model to --
  true only while the studio did its own dispatch. Image generation is now served by an installed
  `image.generate` module that owns provider routing entirely, so the studio has no such knowledge
  to report. It is removed rather than synthesised from the model id prefix, because guessing it
  would re-hardcode the provider knowledge this change exists to delete, and would look like data.
  The remaining row fields (`id`, `label`, `group`, `type`, `capabilities`) are unchanged, and the
  `{models:[...]}` envelope is unchanged. If you consume `provider` from this route, the model's
  declaring module is the source of truth now (`GET /api/modules`).
- **`S3_CHAT_BUCKET` is retired and ignored.** Its only observable effect was breaking chat image
  previews (above). If it is still set, the studio logs a warning naming it at startup and continues
  using `S3_BUCKET`; nothing fails to boot. Remove it from your env.

