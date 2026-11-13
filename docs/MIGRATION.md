# Migrating from 0.2.x to 0.3.0

Every user-visible change between 0.2.5 and 0.3.0, actions first. The [README](https://github.com/webtretech/nestjs-mailer-react-adapter#readme) has the full reference.

## Action needed

1. **Templates load only from inside `template.dir` and `template.dirs`**, with symlinks resolved. `../`, absolute names outside the roots and symlinks leading out fail with `ERR_REACT_ADAPTER_TEMPLATE_OUTSIDE_ROOT`. Add the directory to `template.dirs`:

   ```ts
   // 0.2.x
   await mailer.sendMail({ template: "../shared/welcome", context });
   // 0.3.0
   // MailerModule.forRoot({ template: { dir, dirs: [join(__dirname, "../shared")], adapter } })
   await mailer.sendMail({ template: "welcome", context });
   ```

   Or opt out with `new ReactAdapter({ unsafeAllowOutsideTemplateDir: true })`. The option is constructor only, only the literal `true` counts, and only as an own property: mailer options, `template.options`, `mail.data` and `context` do nothing. It emits no warning and lets templates load from outside the configured roots. Templates are code, so use it only for names you control.

2. **Rootless names.** An absolute name with no `template.dir` and no `template.dirs` is refused unless you opt out (it rendered in 0.2.x). A relative template name with no `template.dir` or `template.dirs` now fails with `ERR_REACT_ADAPTER_TEMPLATE_DIR_MISSING` instead of a synchronous `TypeError`.

3. **Refused names.** Even with the opt-out, these stay refused: a NUL byte, a URL scheme (`release-2026:q1` counts) and Windows device or verbatim names on every OS; drive-letter and UNC names off Windows. On Windows a UNC name loads only from the server and share of a configured UNC root.

4. **Node `>=20.19`.** 0.2.5 allowed `^18.19.1 || ^20.11.1 || >=22.0.0`; Node 18 and 20.11 to 20.18 are no longer supported.

5. **Mailer peer floor `@nestjs-modules/mailer` 2.0.1.** The full range is `^2.0.1 || ^3.0.0 || ^4.0.0`. Version 2.0.0 loads an undeclared `preview-email` and fails with a JSON transport, and installing next to it fails with ERESOLVE.

6. **`react` and `react-dom` are peers** with range `^18.0.0 || ^19.0.0` (0.2.5 declared none). Install them, and `@types/react` for TSX templates.

   ```sh
   # 0.2.x
   npm i @webtre/nestjs-mailer-react-adapter @nestjs-modules/mailer nodemailer
   # 0.3.0
   npm i @webtre/nestjs-mailer-react-adapter @nestjs-modules/mailer nodemailer react react-dom
   npm i -D @types/react
   ```

7. **`plainText` no longer replaces `html` with text.** `html` stays HTML and `mail.data.text` is filled. The option is a deprecated alias of `text`: warning code `REACT_ADAPTER_DEP0001` is emitted once per process when the key is present, true or false, and `text` wins when both are set.

   ```ts
   // 0.2.x
   new ReactAdapter({ plainText: true });
   // 0.3.0
   new ReactAdapter({ text: true });
   ```

8. **Errors are `ReactAdapterError` with a `code`.** A missing template is `ERR_REACT_ADAPTER_TEMPLATE_NOT_FOUND`, no longer Node's `MODULE_NOT_FOUND`. On mailer v4 the send rejects with `MailerTemplateError` whose `cause` is the adapter error.

   ```ts
   // 0.2.x
   if (error.code === "MODULE_NOT_FOUND") {
     // template missing
   }
   // 0.3.0
   const adapterError = error instanceof ReactAdapterError ? error : error.cause;
   if (adapterError?.code === REACT_ADAPTER_ERROR_CODES.TEMPLATE_NOT_FOUND) {
     // template missing
   }
   ```

   The codes: `ERR_REACT_ADAPTER_TEMPLATE_DIR_MISSING`, `ERR_REACT_ADAPTER_TEMPLATE_NOT_FOUND`, `ERR_REACT_ADAPTER_TEMPLATE_LOAD_FAILED`, `ERR_REACT_ADAPTER_INVALID_EXPORT`, `ERR_REACT_ADAPTER_RENDER_FAILED`, `ERR_REACT_ADAPTER_TEXT_FAILED`, `ERR_REACT_ADAPTER_NO_BODY`, `ERR_REACT_ADAPTER_INVALID_MAIL`, `ERR_REACT_ADAPTER_INVALID_TEMPLATE_NAME`, `ERR_REACT_ADAPTER_TEMPLATE_OUTSIDE_ROOT`. See the [README Errors section](https://github.com/webtretech/nestjs-mailer-react-adapter#errors).

9. **Messages no longer contain absolute paths or searched lists.** Read `error.path`, `error.searched` and `error.roots`. Absolute names appear by last segment only, and names are JSON-escaped in messages.

10. **A throw from the mailer callback** on the success path surfaces as an unhandled rejection. The callback is not called a second time.

## Behaviour changes, no action needed

- `@react-email/render` is `^2.3.0` (was exactly 1.0.2) and `locter` is removed; the adapter has its own loader (`require` first, `import()` fallback). Default HTML is the same except that React's `<link rel="preload" as="image">` hint for each `<img>` is no longer added to `<head>`. With `pretty: true` the formatting differs (another formatter: more line breaks, `charset` instead of `charSet`).
- New `text` option: fills `mail.data.text` and never overwrites a caller's `text`. `htmlToTextOptions` and `unstableTextConversion` apply to the text part only. A conversion failure is `ERR_REACT_ADAPTER_TEXT_FAILED`.
- The constructor option type is now `ReactAdapterOptions` (was `@react-email/render`'s `Options`).
- Pass-through: mail with `html` or `raw`, or text-only mail, is left alone. Bodiless mail is `ERR_REACT_ADAPTER_NO_BODY` and malformed mail is `ERR_REACT_ADAPTER_INVALID_MAIL`.
- `template.dirs` works on every mailer version. `template.dir` is searched first, then `template.dirs` in order, and `template.dir` may be omitted when `dirs` is set.
- Extension rule: only a final lowercase `.js`, `.cjs` or `.mjs` counts as an extension, so `welcome.v2` loads `welcome.v2.js`, and `welcome` tries `.js`, `.cjs`, `.mjs` in that order.
- A template that fails to load is `ERR_REACT_ADAPTER_TEMPLATE_LOAD_FAILED`; a native ESM template that failed stays failed until restart.
- A default export that is not a component is `ERR_REACT_ADAPTER_INVALID_EXPORT`.
- A component that throws is `ERR_REACT_ADAPTER_RENDER_FAILED`, with the component error in `cause`.
- Text part per mailer major: v2 and v3 add no text part unless `text: true`; v4 fills it from `html` with `textFromHtml`. See the [README Text part section](https://github.com/webtretech/nestjs-mailer-react-adapter#text-part).
- `compile()` never throws synchronously; every failure reaches the callback once.
