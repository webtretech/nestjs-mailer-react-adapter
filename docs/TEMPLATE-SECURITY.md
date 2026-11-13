# Template security

The core points are in the [README](https://github.com/webtretech/nestjs-mailer-react-adapter#security). This page holds the detail.

## Refused template names

Some names are refused on sight, and `unsafeAllowOutsideTemplateDir` leaves them refused:

- A NUL byte.
- A URL scheme: anything shaped `scheme:`, so `release-2026:q1` counts.
- Windows device or verbatim names, on every OS.
- Drive-letter and UNC names, on Linux and macOS.

On Windows, drive-letter and UNC names are confined like any absolute name, and a UNC name loads only from the server and share of a configured UNC root.

A refused name fails with `ERR_REACT_ADAPTER_INVALID_TEMPLATE_NAME`. See [errors](https://github.com/webtretech/nestjs-mailer-react-adapter/blob/main/docs/ERRORS.md).

## Outside the template directory

`unsafeAllowOutsideTemplateDir` lets templates load from outside the configured roots. It is a constructor option, and only the literal `true` counts. Templates are code, so use it only for names you control.

Root confinement stops template names from escaping. It does not stop someone who can write to the template directory.
