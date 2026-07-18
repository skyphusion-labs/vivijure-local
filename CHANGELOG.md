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
- **`S3_CHAT_BUCKET` is retired and ignored.** Its only observable effect was breaking chat image
  previews (above). If it is still set, the studio logs a warning naming it at startup and continues
  using `S3_BUCKET`; nothing fails to boot. Remove it from your env.

