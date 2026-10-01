# Third-party notices

## BetterBlueKit

The Hyundai Bluelink USA client in `server/src/hyundai/` (the login, vehicle, trip and
status call sequence, and the request headers in `headers.ts`) is a TypeScript port of
`HyundaiUSAAPIClient` from [BetterBlueKit](https://github.com/schmidtwmark/BetterBlueKit),
used under its MIT license:

```
MIT License

Copyright (c) 2025 Mark Schmidt

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## GeoNames

`npm run geonames:load` downloads place names from [GeoNames](https://www.geonames.org/)
at run time. The data is not part of this repository; it is licensed by GeoNames under
[Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).
