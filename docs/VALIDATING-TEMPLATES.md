# Validating templates in CI

Load and render every compiled template before you deploy. Run this after your build.

```js
// check-templates.mjs (run after your build: node check-templates.mjs)
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { ReactAdapter } from "@webtre/nestjs-mailer-react-adapter";

const dir = path.resolve("dist/templates"); // the directory you pass as template.dir
const samples = { welcome: { name: "Ada", code: "123456" } }; // sample props by template name

const adapter = new ReactAdapter();
const render = (template) =>
  new Promise((resolve, reject) => {
    const mail = { data: { template, context: samples[template] ?? {} } };
    adapter.compile(mail, (error) => (error ? reject(error) : resolve(mail.data.html)), {
      template: { dir },
    });
  });

const names = readdirSync(dir, { recursive: true })
  .filter((file) => /\.(js|cjs|mjs)$/.test(file))
  .map((file) => file.replace(/\.(js|cjs|mjs)$/, "").split(path.sep).join("/"));

assert.ok(names.length > 0, `no compiled templates in ${dir}`);
for (const name of new Set(names)) {
  assert.ok((await render(name)).length > 0, `${name} rendered empty HTML`);
  console.log(`ok ${name}`);
}
```

A template missing from `samples` renders with an empty object, so a component that needs props fails; that is the signal to add a sample. The script needs Node 20.19+ and ESM. Nothing in it is tied to a test runner, so you can also wrap it in your runner's own test function.
