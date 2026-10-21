# Vendored libraries

The app's real terminals (desktop mode, `desk.js`) use xterm.js, served from
here as they are published on npm, pinned and named with their versions:

| File | Package |
| --- | --- |
| `xterm-6.0.0.js`, `xterm-6.0.0.css` | `@xterm/xterm@6.0.0` (`lib/xterm.js`, `css/xterm.css`) |
| `xterm-addon-fit-0.11.0.js` | `@xterm/addon-fit@0.11.0` |
| `xterm-addon-unicode11-0.9.0.js` | `@xterm/addon-unicode11@0.9.0` |
| `xterm-addon-web-links-0.12.0.js` | `@xterm/addon-web-links@0.12.0` |
| `xterm-addon-webgl-0.19.0.js` | `@xterm/addon-webgl@0.19.0` |

Their source map comments are taken out. MIT licensed: see `LICENSE-xterm.txt`.
To update, `npm pack` the new versions, copy the same files under new names,
and change the names in `desk.js` (`XTERM`, `WEBGL`).
