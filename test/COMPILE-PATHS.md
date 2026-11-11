# compile() paths and the tests that exercise them

Each row names one `compile()` path and the test that exercises it, by area, repository-relative file and exact test title (or, for `scripts/verify-build.mjs`, the check label used in its `where` strings). `test/compile-paths.test.ts` checks every row against the suite on each `npm test`: a cited file or title that does not exist, a test file that no row cites, or an area with no row fails the suite.

| Area | compile() path | File | Test |
|------|----------------|------|------|
| mail | body already present and no template: every key passes through | test/pass-through.test.ts | no template and %s passes through with every key untouched (COMPAT-04) |
| mail | body present with mailer options {}: no directory rule is applied | test/pass-through.test.ts | pass-through with mailer options {} succeeds without TEMPLATE_DIR_MISSING |
| mail | a template with truthy html passes through untouched | test/pass-through.test.ts | a template with truthy html passes through untouched (D-24) |
| mail | a template with truthy raw passes through untouched | test/pass-through.test.ts | template with truthy raw passes through untouched (D-31) |
| mail | a template with text and no html renders html and leaves text | test/pass-through.test.ts | a template with text and no html renders html and leaves text untouched |
| mail | an empty-string template with text passes through | test/pass-through.test.ts | an empty-string template with text passes through and is never resolved to a .js file |
| mail | pass-through is decided before the context is checked | test/pass-through.test.ts | pass-through is decided before the context is checked |
| mail | NO_BODY: nothing to send, no template, path or cause | test/pass-through.test.ts | %s fails once with ERR_REACT_ADAPTER_NO_BODY and no template, path or cause |
| mail | NO_BODY message names what is missing and no values | test/pass-through.test.ts | the NO_BODY message names what is missing and no values |
| mail | INVALID_MAIL: malformed mail shapes | test/pass-through.test.ts | mail %s fails once with ERR_REACT_ADAPTER_INVALID_MAIL and no template or cause |
| mail | INVALID_MAIL: non-string template | test/pass-through.test.ts | a non-string template names the type and is reported without a template name |
| mail | INVALID_MAIL: context of the wrong type | test/pass-through.test.ts | a context that is %s names its type and never its value |
| mail | null or undefined context renders as an empty context | test/pass-through.test.ts | a %s context renders as an empty context |
| mail | INVALID_MAIL: frozen mail.data | test/pass-through.test.ts | frozen mail.data fails once with INVALID_MAIL and the TypeError as cause |
| mail | INVALID_MAIL: a failure assigning html | test/render.test.ts | a failure assigning html is reported once as ERR_REACT_ADAPTER_INVALID_MAIL with the TypeError as cause (changed in 0.3.0) |
| mail | write step changes only html and text | test/pass-through.test.ts | a send that renders changes only html and text, and keeps every other reference |
| mail | the component runs once per send, even with text and pretty | test/pass-through.test.ts | the component runs once per send, even with text and pretty |
| resolver | relative name: extension order within one directory | test/template-lookup.test.ts | welcome.js wins when .js, .cjs and .mjs all exist |
| resolver | relative name: only .cjs and .mjs exist | test/template-lookup.test.ts | welcome.cjs wins when only .cjs and .mjs exist |
| resolver | relative name: .mjs as the only candidate | test/template-lookup.test.ts | welcome.mjs loads when it is the only candidate |
| resolver | known extension: a dotted name keeps its dots | test/template-lookup.test.ts | dotted.v2 loads dotted.v2.js |
| resolver | known extension: an explicit .mjs loads exactly that file | test/template-lookup.test.ts | an explicit .mjs loads exactly that file, never name.mjs.js |
| resolver | unknown suffix: extensions are appended | test/template-lookup.test.ts | an unknown suffix gets the extensions appended, not replaced |
| resolver | known extensions are case-sensitive | test/template-lookup.test.ts | the known-extension check is case-sensitive and never case-folds |
| resolver | nested names resolve inside the template root | test/template-lookup.test.ts | esm-pkg/welcome resolves inside the template root |
| resolver | nested names with doubled separators | test/template-lookup.test.ts | nested/deep/welcome and nested//deep/welcome find the same file |
| resolver | trailing slash is TEMPLATE_NOT_FOUND with its searched paths | test/template-lookup.test.ts | a trailing slash fails as TEMPLATE_NOT_FOUND with its searched paths |
| resolver | directory order: template.dir before template.dirs | test/template-lookup.test.ts | template.dir wins over a template.dirs entry |
| resolver | directory order: a later template.dirs entry | test/template-lookup.test.ts | a template only in a later template.dirs entry is found there |
| resolver | directory order: the earlier dirs entry wins | test/template-lookup.test.ts | the earlier template.dirs entry wins |
| resolver | not-found searched order | test/template-lookup.test.ts | not-found searched order is dir then dirs, three extensions each |
| resolver | duplicate roots are listed once | test/template-lookup.test.ts | template.dir repeated in template.dirs, or a repeated entry, is listed once |
| resolver | a directory named like a candidate is skipped | test/template-lookup.test.ts | a directory named like a candidate is skipped for the real file |
| resolver | a template.dirs entry that is a regular file is skipped | test/template-lookup.test.ts | a template.dirs entry that is a regular file is skipped |
| resolver | relative name with no template directory: TEMPLATE_DIR_MISSING | test/template-lookup.test.ts | a relative name with neither dir nor dirs is TEMPLATE_DIR_MISSING with no searched list |
| resolver | template.dir missing with template.dirs set | test/template-lookup.test.ts | template.dir missing with template.dirs set searches dirs only |
| resolver | template.dirs that is not an array never throws | test/template-lookup.test.ts | template.dirs that is not an array, or holds non-strings and empty strings, never throws |
| resolver | missing template.dir through the callback | test/render.test.ts | missing template.dir reports ERR_REACT_ADAPTER_TEMPLATE_DIR_MISSING through the callback and never throws (changed in 0.3.0, CORE-02) |
| resolver | missing template reports every searched path | test/render.test.ts | missing template reports ERR_REACT_ADAPTER_TEMPLATE_NOT_FOUND once with every searched path (changed in 0.3.0) |
| resolver | relative template.dir resolves against process.cwd() | test/render.test.ts | characterization: relative template.dir resolves against process.cwd() |
| resolver | stat failure other than not-here is TEMPLATE_LOAD_FAILED | test/template-lookup.test.ts | a stat failure other than not-here is TEMPLATE_LOAD_FAILED with the cause |
| resolver | an over-long name component | test/template-lookup.test.ts | an over-long name component fails once through the callback and never throws |
| resolver | no cache between sends | test/template-lookup.test.ts | lookup keeps no cache: a template created after a failed send renders on the next send |
| resolver | error.template is the exact string passed in | test/template-lookup.test.ts | error.template is the exact string passed in, with no normalization |
| resolver | every published code is an exact ASCII string | test/template-lookup.test.ts | every published code is an exact ASCII ERR_REACT_ADAPTER_ string |
| resolver | the template type is checked before the directory | test/pass-through.test.ts | the template type is checked before the directory |
| resolver | relative missing template with mailer options {} | test/pass-through.test.ts | a relative missing template with mailer options {} reports TEMPLATE_DIR_MISSING |
| resolver | mailer options {} and a relative name never throw | test/template-lookup.test.ts | compile() with an empty mailer options object and a relative name never throws |
| resolver | NOT_FOUND has no cause | test/template-loader.test.ts | template-loader: TEMPLATE_NOT_FOUND has no cause |
| resolver | compile() with undefined mailer options | test/template-confinement.test.ts | compile() with undefined mailer options: a relative name is DIR_MISSING and an absolute name is OUTSIDE_ROOT unless opted out |
| resolver | a missing template in the built artifact, cjs and esm | scripts/verify-build.mjs | does-not-exist |
| confinement | name rules, posix flavor | test/template-confine.test.ts | %j is %s |
| confinement | name rules, win32 flavor | test/template-confine.test.ts | %j is %s |
| confinement | NUL byte through compile() | test/template-confine.test.ts | a NUL byte is INVALID_TEMPLATE_NAME with no path, searched or roots |
| confinement | file: URL scheme through compile() | test/template-confine.test.ts | a file: name is INVALID_TEMPLATE_NAME |
| confinement | node: URL scheme through compile() | test/template-confine.test.ts | a node: name is INVALID_TEMPLATE_NAME |
| confinement | name rules take precedence over DIR_MISSING | test/template-confine.test.ts | the name rules run before the missing-directory rule |
| confinement | verbatim drive form on every OS | test/template-confine.test.ts | a verbatim drive form is INVALID_TEMPLATE_NAME on every OS |
| confinement | a colon inside a path component is an ordinary name | test/template-confine.test.ts | a colon inside a path component is an ordinary relative name |
| confinement | drive-letter and UNC names off Windows | test/template-confine.test.ts | drive-letter and UNC names are INVALID_TEMPLATE_NAME off Windows |
| confinement | Windows drive-letter name inside a root and outside every root (D-05) | test/template-confinement.test.ts | a drive-letter absolute name inside a root loads and one outside every root is TEMPLATE_OUTSIDE_ROOT (D-05 exception) |
| confinement | UNC share guard table (D-23) | test/template-confine.test.ts | %j with roots %j, allowOutside %j, flavor %#: %s |
| confinement | UNC name on a server no root uses is refused before any access (D-23) | test/template-lookup.test.ts | a UNC name on a server no root uses is INVALID_TEMPLATE_NAME (D-23) |
| confinement | absolute names shown by their last segment, messageTemplateName table (D-26) | test/template-confine.test.ts | %j shows as %j |
| confinement | absolute name with a NUL byte shows only its last segment (D-26) | test/template-confine.test.ts | an absolute name with a NUL byte shows only its last segment |
| confinement | absolute name shown by its last segment and whole on error.template (D-26) | test/error-messages.test.ts | an absolute template name appears in a message only as its last path segment and stays whole on error.template (D-26) |
| confinement | rootless absolute name is refused (D-20) | test/template-lookup.test.ts | an absolute name with no template.dir is TEMPLATE_OUTSIDE_ROOT with an empty roots list (changed in 0.3.0, D-20) |
| confinement | rootless absolute name with the opt-out renders (D-20) | test/template-lookup.test.ts | an absolute name with no template.dir renders with unsafeAllowOutsideTemplateDir: true (D-20) |
| confinement | ../ escape is existence-independent | test/template-confinement.test.ts | a ../ escape is TEMPLATE_OUTSIDE_ROOT whether or not the target exists (D-01, D-03) |
| confinement | absolute name outside every root | test/template-confinement.test.ts | an absolute name outside every root is TEMPLATE_OUTSIDE_ROOT whether or not the file exists (D-01, D-02) |
| confinement | .. and . segments that stay inside load | test/template-confinement.test.ts | a name that stays inside through .. or . segments loads (D-03) |
| confinement | root, real-path and alias spellings of an inside name | test/template-confinement.test.ts | an absolute name inside a root loads through the root, its real path or an alias (D-02, D-17) |
| confinement | letter case decided by the filesystem | test/template-confinement.test.ts | letter case of a root or name is decided by the filesystem, not by the adapter (D-17) |
| confinement | missing name inside a root is NOT_FOUND | test/template-confinement.test.ts | a missing name inside a root is TEMPLATE_NOT_FOUND, not TEMPLATE_OUTSIDE_ROOT (D-17) |
| confinement | sibling directory sharing the root name prefix | test/template-confinement.test.ts | a sibling directory that shares the root's name prefix is outside (edge SEC-01/adjacency) |
| confinement | symlink out of a root is refused | test/template-confinement.test.ts | a symlink inside a root that points outside is refused, file and directory links alike (D-04, SEC-02) |
| confinement | symlink that resolves inside the root loads | test/template-confinement.test.ts | a symlink that resolves inside the root loads (D-04) |
| confinement | symlinked root | test/template-confinement.test.ts | a root that is itself a symlink works for relative and absolute names (D-04) |
| confinement | several roots: a file inside any root loads | test/template-confinement.test.ts | every configured root counts, and a file inside any of them is accepted (D-07) |
| confinement | missing root contributes nothing | test/template-confinement.test.ts | a missing root contributes nothing that can load and reports TEMPLATE_NOT_FOUND (edge SEC-01/empty) |
| confinement | dangling symlink inside a root (D-25) | test/template-confinement.test.ts | a dangling symlink inside a root is TEMPLATE_NOT_FOUND (accepted planter-only exception, D-25) |
| confinement | outside candidate skipped, a later inside file loads (D-24) | test/template-confinement.test.ts | an outside candidate is skipped and the first inside regular file in lookup order loads (D-24, edge SEC-01/ordering) |
| confinement | an earlier root's escaping folder does not hide a later root's file (D-24) | test/template-confinement.test.ts | an earlier root's escaping candidate does not hide a later root's file (D-24) |
| confinement | an escape with nothing inside is OUTSIDE_ROOT (D-24) | test/template-confinement.test.ts | an escape with no inside file is TEMPLATE_OUTSIDE_ROOT, never TEMPLATE_NOT_FOUND (D-24) |
| confinement | names compared as the filesystem stores them | test/template-confinement.test.ts | names are compared as the filesystem stores them: no decoding, folding or normalising (edge SEC-01/encoding) |
| confinement | concurrent escaping and inside sends | test/template-confinement.test.ts | concurrent sends of an escaping and an inside name each get their own outcome (edge SEC-01/concurrency) |
| confinement | real location of existing and missing paths | test/template-confinement.test.ts | resolveRealLocation returns the real path for existing files and the deepest resolvable ancestor plus the tail for missing ones |
| confinement | the verified real path is the one loaded (D-22) | test/template-confinement.test.ts | the verified real path is the loaded path: error.path is the real path on INVALID_EXPORT and RENDER_FAILED (D-22) |
| confinement | symlinked root and real path evaluate once | test/template-confinement.test.ts | a template reached through a symlinked root and through its real path is evaluated once |
| confinement | isInsideRoot containment table, posix | test/template-confinement.test.ts | isInsideRoot (posix) %s contains %s: %s |
| confinement | isInsideRoot containment table, win32 | test/template-confinement.test.ts | isInsideRoot (win32) %s contains %s: %s |
| confinement | opt-out loads outside, ../ and symlink out | test/template-confinement.test.ts | with the opt-out an absolute name outside, ../ and a symlink out load as in 0.2.x (D-11) |
| confinement | opt-out keeps NUL, scheme and device names refused | test/template-confinement.test.ts | NUL, URL-scheme and verbatim device names stay INVALID_TEMPLATE_NAME with the opt-out on every OS (D-11) |
| confinement | opt-out keeps drive-letter and UNC names refused off Windows | test/template-confinement.test.ts | drive-letter and UNC names stay INVALID_TEMPLATE_NAME with the opt-out off Windows (D-19) |
| confinement | opt-out is constructor-only, five vectors (D-12) | test/template-confinement.test.ts | the key in template.options, template, the top level, the options bag, mail.data or context does not enable it (D-12) |
| confinement | opt-out is constructor-only in the lookup (D-12) | test/template-lookup.test.ts | the key anywhere but the constructor does not lift the refusal (D-12) |
| confinement | opt-out strict true | test/template-confinement.test.ts | constructor values other than the literal true do not enable it (D-12) |
| confinement | opt-out strict true in the lookup | test/template-lookup.test.ts | only the literal true enables the option |
| confinement | opt-out never warns or logs | test/template-confinement.test.ts | constructing with the opt-out and rendering outside a root never warns or logs (D-13) |
| confinement | opt-out emits no warning in the lookup | test/template-lookup.test.ts | constructing with the option emits no warning (D-13) |
| confinement | invariant: every located file is inside a root | test/template-confinement.test.ts | every file locateTemplate returns lies inside a configured root unless the opt-out is on |
| confinement | absolute path outside template.dir needs the opt-out | test/render.test.ts | characterization: an absolute path outside template.dir renders only with unsafeAllowOutsideTemplateDir (changed in 0.3.0) |
| confinement | every code is produced without a path in its message (D-09, D-10) | test/error-messages.test.ts | every published code is produced by at least one send and no message contains an absolute path (D-09, D-10, D-26) |
| confinement | confinement and name rules in the built artifact, cjs and esm | scripts/verify-build.mjs | confinement |
| confinement | escape refusal and the opt-out in the built artifact, cjs and esm | scripts/verify-build.mjs | escape |
| loader | require() loads CommonJS templates by absolute path | test/loader-require.test.ts | %s is required once by its absolute path, require() does not throw, and the template renders |
| loader | tsc-compiled CJS template | test/render.test.ts | characterization: tsc-compiled CJS template by relative name without extension |
| loader | SWC-compiled CJS template with a default getter | test/render.test.ts | characterization: SWC-compiled CJS template with a default getter |
| loader | CJS template assigned to module.exports | test/render.test.ts | characterization: CJS template assigned to module.exports |
| loader | native ESM .mjs template | test/render.test.ts | characterization: native ESM .mjs template with an explicit extension |
| loader | .js template under a type module package | test/render.test.ts | characterization: .js template under a type module package, loaded from a subdirectory |
| loader | top-level-await ESM through the import() fallback | test/render.test.ts | characterization: top-level-await ESM template loads through the import() fallback |
| loader | dotted template name | test/render.test.ts | characterization: dotted template name dotted.v2 |
| loader | ERR_REQUIRE_ESM falls back to import() | test/loader-fallback.test.ts | characterization: ERR_REQUIRE_ESM from require() falls back to import() |
| loader | ERR_REQUIRE_ASYNC_MODULE falls back to import() | test/loader-fallback.test.ts | characterization: ERR_REQUIRE_ASYNC_MODULE from require() falls back to import() |
| loader | any other require() error never falls back | test/loader-fallback.test.ts | any other require() error is reported once as ERR_REACT_ADAPTER_TEMPLATE_LOAD_FAILED and never falls back (changed in 0.3.0, D-14) |
| loader | a .cjs template is never retried through import() | test/template-loader.test.ts | template-loader: a .cjs template whose dependency needs import() is not evaluated a second time |
| loader | native ESM that failed to load stays failed (Phase 2 D-22) | scripts/verify-build.mjs | esm-throws |
| loader | memo() default export | test/template-loader.test.ts | template-loader: a memo() default export renders |
| loader | forwardRef() default export | test/template-loader.test.ts | template-loader: a forwardRef() default export renders |
| loader | INVALID_EXPORT for non-component exports | test/template-loader.test.ts | template-loader: module.exports = %s fails once as INVALID_EXPORT saying what was found |
| loader | INVALID_EXPORT for exports.default without __esModule | test/render.test.ts | CJS template with exports.default and no __esModule fails with ERR_REACT_ADAPTER_INVALID_EXPORT naming the shape (changed in 0.3.0, D-28) |
| loader | INVALID_EXPORT for an ESM template without a default export | test/render.test.ts | ESM template with no default export fails with ERR_REACT_ADAPTER_INVALID_EXPORT listing its exports (changed in 0.3.0, CORE-05) |
| loader | INVALID_EXPORT has no cause | test/template-loader.test.ts | template-loader: INVALID_EXPORT has no cause |
| loader | LOAD_FAILED for a syntax error | test/template-loader.test.ts | template-loader: a syntax error fails once as TEMPLATE_LOAD_FAILED with the SyntaxError as cause |
| loader | a template that throws at load is retried once fixed | test/template-loader.test.ts | template-loader: a CommonJS template that throws at load is retried on the next send once it is fixed |
| loader | load-failure cause rule: a missing dependency shows only its code (D-21) | test/template-loader.test.ts | template-loader: a missing dependency fails as TEMPLATE_LOAD_FAILED naming MODULE_NOT_FOUND and no path (D-21) |
| loader | load-failure cause rule: a syntax error message is quoted (D-21) | test/template-loader.test.ts | template-loader: a syntax error's own message is quoted (D-21) |
| loader | load-failure cause rule: an error without a code is quoted (D-21) | test/template-loader.test.ts | template-loader: an error thrown at load without a code is quoted (D-21) |
| loader | load-failure cause rule: a string code shows only the code (D-21) | test/template-loader.test.ts | template-loader: a thrown error with a string code shows only the code (D-21) |
| loader | load-failure cause rule: a non-Error value is quoted (D-21) | test/template-loader.test.ts | template-loader: a non-Error value thrown at load is quoted (D-21) |
| renderer | html output | test/render.test.ts | characterization: tsc-compiled CJS template by relative name without extension |
| renderer | pretty option | test/render.test.ts | characterization: pretty option renders formatted HTML |
| renderer | pretty html equals render pretty | test/text.test.ts | pretty html equals render(node, { pretty: true }) |
| renderer | pretty with text builds text from the raw html | test/text.test.ts | with pretty and text, html is the pretty characterization and text is built from the raw html |
| renderer | pretty formatter failure is RENDER_FAILED | test/error-messages.test.ts | a pretty formatter failure fails once as RENDER_FAILED and writes no html (TEST-01) |
| renderer | a component that throws is RENDER_FAILED without leaking the context | test/template-loader.test.ts | template-loader: a component that throws while rendering fails once as RENDER_FAILED without leaking the context |
| renderer | a component that throws undefined keeps an undefined cause | test/template-loader.test.ts | template-loader: a component that throws undefined fails as RENDER_FAILED and keeps an undefined cause |
| renderer | a component that renders null yields a doctype string | test/text.test.ts | a component that renders null still yields a doctype string |
| renderer | html starts with the XHTML doctype | test/text.test.ts | html starts with the XHTML doctype for options %j |
| text options | no text key when the text option is off | test/text.test.ts | no text key is added when the text option is off |
| text options | text: true fills text | test/text.test.ts | text: true fills text with what render produces for plainText |
| text options | htmlToTextOptions reach the converter | test/text.test.ts | htmlToTextOptions reach the converter and match render's own output |
| text options | unstableTextConversion wins over htmlToTextOptions | test/text.test.ts | unstableTextConversion uses the in-house formatter and wins over htmlToTextOptions |
| text options | empty htmlToTextOptions | test/text.test.ts | htmlToTextOptions {} gives the same text as no options |
| text options | render never receives the adapter's own keys | test/text.test.ts | render runs once per send and never receives the adapter's own keys |
| text options | a mutation of the options after construction changes nothing | test/text.test.ts | a mutation of the options object after construction changes nothing |
| text options | a caller text is kept and no conversion runs | test/text.test.ts | a caller text of %s is kept and no conversion runs |
| text options | non-ASCII context round-trips | test/text.test.ts | non-ASCII context round-trips exactly as toPlainText produces it |
| text options | TEXT_FAILED when the converter fails | test/text.test.ts | a converter failure fails the send once as TEXT_FAILED and writes neither html nor text |
| text options | 0.2.x option shapes still type-check and construct | test/text.test.ts | the 0.2.x option shapes still type-check and construct |
| text options | plainText: true warns once per process | test/deprecation.test.ts | two constructions with plainText: true warn once per process |
| text options | the deprecation warning carries its code | test/deprecation.test.ts | the warning is a DeprecationWarning with code REACT_ADAPTER_DEP0001 naming plainText and text |
| text options | plainText: false warns too | test/deprecation.test.ts | plainText: false warns too, whenever the key holds a boolean |
| text options | no warning without a boolean plainText | test/deprecation.test.ts | %s does not warn |
| text options | plainText: true keeps HTML and fills text | test/deprecation.test.ts | plainText: true keeps HTML in html and fills text |
| text options | text: false wins over plainText: true | test/deprecation.test.ts | text: false wins over plainText: true: no text, and the warning is still emitted |
| text options | text: true wins over plainText: false | test/deprecation.test.ts | text: true wins over plainText: false: text is filled, and the warning is emitted |
| text options | plainText: false alone fills no text | test/deprecation.test.ts | plainText: false alone fills no text |
| callback count | a callback that throws on the success path is called once | test/render.test.ts | a callback that throws on the success path is called once and its throw becomes an unhandled rejection |
| callback count | a callback that throws on the not-found path is called once | test/template-lookup.test.ts | a callback that throws on the not-found path is called once and its throw becomes an unhandled rejection |
| callback count | concurrent compile() calls each get their own outcome | test/template-lookup.test.ts | concurrent compile() calls for different templates each get their own outcome |
| callback count | NO_BODY fails once | test/pass-through.test.ts | %s fails once with ERR_REACT_ADAPTER_NO_BODY and no template, path or cause |
| callback count | INVALID_MAIL fails once | test/pass-through.test.ts | mail %s fails once with ERR_REACT_ADAPTER_INVALID_MAIL and no template or cause |
| callback count | an over-long name fails once through the callback | test/template-lookup.test.ts | an over-long name component fails once through the callback and never throws |
| callback count | a render failure is raised once and never wrapped again | test/template-loader.test.ts | template-loader: a component that throws while rendering fails once as RENDER_FAILED without leaking the context |
| callback count | a text conversion failure is raised once | test/text.test.ts | a converter failure fails the send once as TEXT_FAILED and writes neither html nor text |
