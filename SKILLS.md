# Forge skills

A skill is one Markdown file you upload on the **Skills** page. It can carry four kinds of fenced blocks; everything else is instructions for you (and training text if you also upload it in the Trainer).

| Block | Purpose | Required for a tool skill |
|---|---|---|
| `forge-schema` | JSON object describing the tool's input fields | recommended |
| `forge-tool` | JavaScript that defines `function run(input)` | yes |
| `forge-tests` | JSON array of cases the tool must pass before it is installed | yes |
| `forge-example` | JSON `{prompt, response}` pairs (or an array) the model can be trained on | optional |

Front matter (between `---` lines, `key: value` or `key: [a, b]`):

- `name` — skill name, 1–64 lowercase letters, digits, `-` or `_` (defaults to the file name).
- `version`, `description` — shown in the list.
- `tool` — tool name the model calls (defaults to `name`).
- `output_format` — optional template rendered from the result, e.g. `"{displacement_liters:3} L"` (`:3` = three decimals).
- `permissions`, `runtime` — must be absent/`forge-js`; skills asking for network, storage or other permissions are refused.

## What installing does

1. The code is shown; you must read it and tick the approval box. The hash of the approved code is stored and checked on every run.
2. Every `forge-tests` case is executed in the sandbox. One failure blocks installation.
3. The sandbox is an opaque-origin `<iframe sandbox="allow-scripts">` with CSP `default-src 'none'`, running the code in a Worker. Tools have no network, no storage, no DOM, no `importScripts`; a run is terminated after 2 s (configurable per call). Results must be JSON-serialisable and under 64 KiB.
4. Input is validated against `forge-schema` before the code runs: types (`number`, `integer`, `string`, `boolean`), `min`/`max`, `maxLength`, `enum`, `required: false` with optional `default`. Unknown fields are rejected.

## How the model uses a tool

The model is a byte-level network; it gains a tool by learning to answer matching prompts with the canonical call text:

```
[tool:engine_displacement] {"bore_mm":86,"stroke_mm":86,"cylinders":4}
```

When a model response matches that pattern, the app validates the JSON against the schema, runs the tool in the sandbox and prints the result under the answer. Sources of training pairs for this:

- `forge-example` blocks whose `response` is a tool call;
- `forge-tests` cases that carry a `prompt` (the pair prompt → canonical call of that case's `input` is derived automatically).

Press **Queue training examples for the active model** on the Skills page to enqueue them; receipts in the Trainer show when the weights have changed, and the training-example reproduction check shows whether the model emits the call for the trained prompts. Nothing guarantees it will generalise to differently worded prompts — test, correct, repeat.

You can always call a tool yourself: `/skills` lists them, `/tool engine_displacement {"bore_mm":86,"stroke_mm":86,"cylinders":4}` runs one.

## Tests

```json
[
  { "name": "label", "prompt": "optional natural-language prompt", "input": { "...": 1 }, "expected": { "subset": 1 }, "absolute_tolerance": 0.001 },
  { "input": { "...": 0 }, "expect_error": true }
]
```

`expected` may be a subset of the result's keys; numbers compare within `absolute_tolerance` (default 1e-9). `expect_error` passes when the schema or the tool rejects the input.

## Complete example

````markdown
---
name: engine-displacement
version: 1
description: Swept displacement of a piston engine from bore, stroke and cylinder count.
tool: engine_displacement
output_format: "Displacement: {displacement_liters:3} L ({displacement_cc:0} cc) from {cylinders} cylinders"
---
# Engine displacement

Swept volume per cylinder is π/4 · bore² · stroke; total displacement multiplies by the cylinder count.
Bore and stroke are in millimetres; results are in cubic centimetres and litres.

```forge-schema
{
  "bore_mm": { "type": "number", "min": 1, "max": 1000 },
  "stroke_mm": { "type": "number", "min": 1, "max": 1000 },
  "cylinders": { "type": "integer", "min": 1, "max": 64 }
}
```

```forge-tool
function run(input) {
  const perCylinderMm3 = Math.PI / 4 * input.bore_mm * input.bore_mm * input.stroke_mm;
  const cc = perCylinderMm3 * input.cylinders / 1000;
  return { displacement_cc: cc, displacement_liters: cc / 1000, cylinders: input.cylinders };
}
```

```forge-tests
[
  { "name": "Miata 1.8 BP", "prompt": "What is the displacement of an 83 mm bore, 85 mm stroke four cylinder?", "input": { "bore_mm": 83, "stroke_mm": 85, "cylinders": 4 }, "expected": { "displacement_liters": 1.839 }, "absolute_tolerance": 0.001 },
  { "name": "square V8", "prompt": "Displacement for a V8 with 86 mm bore and 86 mm stroke?", "input": { "bore_mm": 86, "stroke_mm": 86, "cylinders": 8 }, "expected": { "displacement_cc": 3996.46 }, "absolute_tolerance": 0.01 },
  { "name": "rejects zero bore", "input": { "bore_mm": 0, "stroke_mm": 86, "cylinders": 8 }, "expect_error": true }
]
```

```forge-example
{ "prompt": "Work out the displacement of a 4 cylinder, 86 mm bore, 86 mm stroke engine", "response": "[tool:engine_displacement] {\"bore_mm\":86,\"stroke_mm\":86,\"cylinders\":4}" }
```
````

The same file is available from **Download a template skill** on the Skills page.

## Skills without code

A Markdown file with no `forge-tool` block installs as reference text or examples only. Uploading it in the **Trainer** instead (or as well) trains the model on its text; `forge-example` pairs train question → answer. Code inside ordinary fences is training text and is never executed.
