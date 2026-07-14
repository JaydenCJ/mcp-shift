# docs assets

`assets/demo.svg` is the demo visual embedded at the top of all three READMEs.
It is a hand-assembled terminal-style SVG whose every line of output was
copied from real runs of the commands it shows (`mcp-shift lint`,
`codemod --write`, `detect`, `proxy` + `examples/legacy-client.mjs`), with
long lines truncated using `...`. Text-only, ~6 KB, renders natively on
GitHub in both color schemes.

To refresh it after output changes:

1. Re-run the commands shown in the image (see the Quickstart section of
   `README.md`, or `bash examples/demo.sh` for the full walkthrough).
2. Replace the affected `<text>` lines in `assets/demo.svg` with the new
   output, escaping `&`, `<`, `>` as XML entities.
3. Keep the image identical across all three READMEs (they all reference
   `docs/assets/demo.svg`).

A 30-second animated recording (asciinema/vhs) of `examples/demo.sh` is
planned for the launch window; when it exists it will complement — not
replace — the static SVG, which stays the README first-screen asset.
