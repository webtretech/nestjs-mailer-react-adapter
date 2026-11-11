export const REACT_ADAPTER_ERROR_CODES = {
  TEMPLATE_DIR_MISSING: "ERR_REACT_ADAPTER_TEMPLATE_DIR_MISSING",
  TEMPLATE_NOT_FOUND: "ERR_REACT_ADAPTER_TEMPLATE_NOT_FOUND",
  TEMPLATE_LOAD_FAILED: "ERR_REACT_ADAPTER_TEMPLATE_LOAD_FAILED",
  INVALID_EXPORT: "ERR_REACT_ADAPTER_INVALID_EXPORT",
  RENDER_FAILED: "ERR_REACT_ADAPTER_RENDER_FAILED",
  TEXT_FAILED: "ERR_REACT_ADAPTER_TEXT_FAILED",
  NO_BODY: "ERR_REACT_ADAPTER_NO_BODY",
  INVALID_MAIL: "ERR_REACT_ADAPTER_INVALID_MAIL",
} as const;

export type ReactAdapterErrorCode =
  (typeof REACT_ADAPTER_ERROR_CODES)[keyof typeof REACT_ADAPTER_ERROR_CODES];

export class ReactAdapterError extends Error {
  readonly code: ReactAdapterErrorCode;
  readonly template: string | undefined;
  readonly path: string | undefined;
  readonly searched: readonly string[] | undefined;

  constructor(
    code: ReactAdapterErrorCode,
    message: string,
    init: {
      template?: string;
      path?: string;
      searched?: readonly string[];
      cause?: unknown;
    } = {}
  ) {
    super(
      message,
      init.cause === undefined ? undefined : { cause: init.cause }
    );
    this.name = "ReactAdapterError";
    this.code = code;
    this.template = init.template;
    this.path = init.path;
    this.searched = init.searched;
  }
}
