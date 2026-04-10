use pnpm.  
use the `browser` namespace.  
use early returns whenever it'll make the code more readable. and maintainable.
Use functional programming.  
use wxt for the extension framework.  
use svelte 5 for the content script and popup.  
use @ffmpeg/ffmpeg for the video and audio processing.  
use @webext-core/messageing for message passing.  
use 100% type safety in typescript.  
make the UI as accessible as possible.  
support for chromium browsers (chrome, edge, opera) and firefox mv3 is mandatory.  
don't use abbreviations, use full words for variables and function names. Exception: event handler parameters use `e` instead of `event`.
Use modern browser and CSS features.  

use DRY wherever possible while retaining maintainability and prioritizing readability.  
In every message in the UI, don't add full stops.  
Make UI messages informal.  
the code must always be DRY and with separation of concerns.  
use async-await whenever possible.  
If there is a single use function in Svelte, inline it.  
Minimize indentations.  
Don't automatically store stuff in the storage, instead, First, rely on fallback value and only rely on storage if the user has explicitly set it.  
don't use em dash, use regular hyphen.  
After each modification, lint the project with ESLint and Stylelint and svelte-check and knip.
Let TypeScript infer return types instead of annotating them explicitly.
Extract @attach arrow functions in Svelte templates to named functions in the script block.
Avoid adding `window.` prefixes, unless it will increase the readability, in which case it is allowed.  
don't use `.forEach`, use `for-of` instead.  
if there is a callback arrow function, don't explicitly assign a type to the param.  
avoid using hardcoded strings, use enums instead.  
Avoid using `setTimeout` unless absolutely necessary.  
If you need to use a hardcoded number or a string, first try to use an enum, and if no enum exists, either make the enum if it makes sense, or put in a descriptive variable.  
The dev server script (scripts/dev-server.ts) is configured such that on every file modification under src/, the extension is automatically rebuilt and reloaded and every YouTube page is reloaded, allowing proper content scripts reinjections.  
Avoid comments unless absolutely necessary, prefer using descriptive variables and functions.  

Variable naming rules:
1. If a variable represents an element, it should be prefixed with "el"
2. If a variable represents an index, it should be prefixed with "i", unless it's iterating over an array in a for loop/higher-order function, in which case use "I" as-is
3. If a variable represents a boolean, it should be prefixed with "is"
4. An event callback's first parameter must always be "e"
