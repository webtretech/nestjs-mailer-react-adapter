# Errors

Failures reach the mailer callback as a `ReactAdapterError` with `code`, `template`, `path`, `searched`, `roots` and `cause`. On mailer v4 the send rejects with `MailerTemplateError`, whose `cause` is the `ReactAdapterError`; v2 and v3 reject with the adapter error itself. Messages carry no absolute paths, so read the `path`, `searched` and `roots` fields instead.

| Code | When |
| --- | --- |
| `ERR_REACT_ADAPTER_TEMPLATE_DIR_MISSING` | Relative template name and no `template.dir` or `template.dirs` |
| `ERR_REACT_ADAPTER_TEMPLATE_NOT_FOUND` | No candidate file exists (see `searched` and `roots`) |
| `ERR_REACT_ADAPTER_TEMPLATE_LOAD_FAILED` | The file exists but cannot be loaded or inspected (see `cause`) |
| `ERR_REACT_ADAPTER_INVALID_EXPORT` | The default export is not a component |
| `ERR_REACT_ADAPTER_RENDER_FAILED` | The component threw, or `pretty` failed |
| `ERR_REACT_ADAPTER_TEXT_FAILED` | Text conversion failed |
| `ERR_REACT_ADAPTER_NO_BODY` | No template, and no `html`, `text` or `raw` |
| `ERR_REACT_ADAPTER_INVALID_MAIL` | `mail`, `mail.data`, `template` or `context` has the wrong type, or `mail.data` is not writable |
| `ERR_REACT_ADAPTER_INVALID_TEMPLATE_NAME` | Name refused on sight (NUL byte, URL scheme, device form; drive-letter and UNC names off Windows) |
| `ERR_REACT_ADAPTER_TEMPLATE_OUTSIDE_ROOT` | Real location outside the roots, or an absolute name with no roots |

`REACT_ADAPTER_ERROR_CODES` is exported for comparisons.
