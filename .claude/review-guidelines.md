# Code Review Guidelines

Filtered to what applies to this codebase: a plain-JavaScript (no
TypeScript), ESM, Node.js library/CLI that scrapes registrar pricing pages
and APIs (Namecheap, OpenProvider, NIRA, NameSilo) and writes structured JSON/CSV
price lists to `data/`.

### Coercion & comparisons

- Use `Number()` to parse, and check the result for `NaN` explicitly — don't
  trust `parseInt`/`parseFloat`/unary `+` for general numeric parsing.
- `Math.floor(Number(x))` for integer parsing, not bit tricks.

### Functions

- Prefer function declarations for named, module-level functions; arrow
  functions for callbacks.
- Prefer small functions and use composition. Small functions are easier to
  understand, debug, test and reuse.

### Exceptions & Errors

- When catching, assume the thrown value is an `Error` instance unless an
  API is conclusively documented to throw something else.
- An empty `catch` block is almost never correct — if you really mean to
  swallow the error, add a comment explaining why.
- Exceptions should be used for truly exceptional errors. An expected error
  (e.g. a registrar returning a documented error response) is not
  exceptional — handle it as data.
- Throw only `Error` or subtypes of `Error`. Do not throw primitives or
  objects.
- When rethrowing an error, propagate the original error through `{cause}`.
- A good error is informative, actionable, clear and concise.

### Try blocks

- Keep the code inside a `try` focused on the statements that can actually
  throw; move everything else outside it so failures aren't attributed to
  the wrong line.

### Comments & JSDoc

- `/** JSDoc */` for anything documenting an API surface; `//` line comments
  for implementation notes.
- No boxed/asterisk-bordered comment blocks.
- Use a comment when it is infeasible to make your code self-explanatory.
- A good comment describes *why*, not *what* the code is doing.

### Naming

- No ambiguous abbreviations, and don't abbreviate by deleting internal
  letters (`indx` for `index`) — acronym-style abbreviation (`id`, `url`)
  is fine.
- Treat acronyms as whole words in identifiers (`userId`, not `userID`).

### Registrar-scraping reliability

- Network calls to registrar APIs must go through `src/http.js`'s retry
  helper (or an equivalent explicit backoff), not a bare `fetch`. Registrar
  APIs are flaky; a generator that silently returns partial data on a
  transient failure produces a bad price list, not a visible error.
- Prefer failing loudly (throw) over silently omitting a TLD when a
  registrar response can't be parsed. A missing TLD in the output is much
  harder to notice than a thrown error.
- Keep generator output deterministic for the same input: no reliance on
  object key iteration order for anything user-visible, and sort output
  arrays (already done in `unified.js`) rather than leaving them in
  whatever order the source data arrived.
- Don't hardcode credentials or registrar sandbox URLs; read them from
  `context.env` (see `getCredentials` in the existing generators).

### Testing

- Real implementations or high-quality fakes are preferred over mock-heavy
  tests. Registrar generators that hit real APIs are the exception:
  network-bound tests are impractical to run in CI, so unit tests here
  exercise pure functions (e.g. `generateCatalogRows`, `catalogRowsToCsv`)
  with fixture data instead.
- Avoid starting test descriptions with "should"; describe the behavior
  directly using an active verb: `test('returns NaN')`, not
  `test('should return NaN')`.
- Test behaviors, not implementations. Focus tests on the public exports of
  a module. Refrain from change-detector tests: if someone refactors
  internal logic without changing behavior, the tests should still pass.

### Commits

- A commit should be one self-contained change, and its description should
  reflect the scope of changed files.
- Prefer small commits over large ones. They are easier to review, can be
  reviewed more thoroughly, and are less likely to introduce bugs.
- If a commit contains multiple disparate changes, suggest breaking it up
  into smaller focused commits.
- Generated output under `data/` and `docs/` should not be hand-edited in
  the same commit as a source change unless the commit is specifically about
  regenerating that output (e.g. `chore(data): auto-update prices`).

### General change-level guides

- While uncommon, certain changes may warrant updates to `README.md`; report
  this if applicable. `README.md` should be more correct and concise than
  complete.
- Be wary of adding new dependencies to minimize supply-chain risks. If the
  dependency is minor or can be trivially inlined, inline it.
- This package is published to npm (`namewiz/registrar-pricelist`) and used
  by other repos in this org via its `bin`/`exports` surface. Changes to
  `src/cli.js`'s CLI flags or `src/generators/index.js`'s exports are
  breaking-change candidates — flag them.
- Review every line of the change diligently — you are the final gate of
  quality, maintainability, and security for this code.
- If, in the course of review, you identify an issue unrelated to the
  change under review, report it without blocking the commit.
