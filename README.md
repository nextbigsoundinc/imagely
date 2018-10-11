Imagely
=======
Imagely renders any browserable content as an image, including:

- Local HTML or SVG files
- Remote URLs
- D3 visualizations
- jQuery/Angular/React/Ember-powered UIs

If it can be viewed in a WebKit browser, Imagely can render it.


Installation
------------
```sh
npm install imagely
```

To enable command-line usage, install with `--link`:
```sh
npm install imagely --link
```


Usage
-----

#### Node
```js
var imagely = require('imagely');
imagely(source, destination, [options], [callback]);
```

Parameters:

- `source` (String) URL or local filepath to render. **Required.**
- `destination` (String) Filepath of the image file to generate. Supported file types: PNG, GIF, JPEG, PDF. **Required.**
- `options` (Object) See options below.
- `options.width` (Number) Viewport pixel width.
- `options.height` (Number) Viewport pixel height.
- `options.scale` (Number) Zoom level at which to render, necessary for generating HiDPI/Retina images (e.g. scale = 2). Defaults to 1.
- `options.bg` (String) Background color. Defaults to transparent.
- `options.json` (String) Filepath of a JSON file to preload. File contents will be accessible via `window.data` and available for any scripts in the source file to use.
- `options.batch` (Flag) If you want to loop over `options.data` to create multiple images. This assumes that all created images are identical except for the `window.data` you inject on the page.
- `callback` (Function) Function that will be called after the image has been successfully generated.


#### Command line
```sh
imagely source destination [--width=<number>] [--height=<number>] [--scale=<number>] [--bg=<color>] [--json=<path>] [--log]
```

Parameters:

- `source` (String) URL or local filepath to render. **Required.**
- `destination` (String) Filepath of the image file to generate. Supported file types: PNG, GIF, JPEG, PDF. **Required.**
- `-w`, `--width` (Number) Viewport pixel width.
- `-h`, `--height` (Number) Viewport pixel height.
- `-s`, `--scale` (Number) Zoom level at which to render, necessary for generating HiDPI/Retina images (e.g. scale = 2). Defaults to 1.
- `-b`, `--bg` (String) Background color. Defaults to transparent.
- `-d`, `--json` (String) Filepath of a JSON file to preload. File contents will be accessible via `window.data` and available for any scripts in the source file to use.
- `-l`, `--log` (Flag) If specified, the dimensions of the final image will be logged to the console as `width height`.
- `--batch` (Flag) If specified, imagely will loop through the `--json` file as an array. Each iteration will be injected into the page as `window.data`.

Examples
--------
As shown below, Imagely can be used interchangeably within Node or the command line. See the [examples directory](examples) for the full example files.

#### D3 chart
```js
// Node
var imagely = require('imagely');
imagely(
	'examples/d3/chart.html',
	'examples/d3/chart.gif',
	{
		json: 'examples/d3/data.json',
		bg: 'white'
	}
);
```
```sh
# Command line
imagely examples/d3/chart.html examples/d3/chart.gif --json=examples/d3/data.json --bg=white
```

#### Batched D3 chart
```js
// Node
var imagely = require('imagely');
imagely(
	'examples/d3-batch/chart.html',
	'examples/d3-batch/chart.gif',
	{
		json: 'examples/d3-batch/data.json',
		bg: 'purple',
		batch: true
	}
);
```
```sh
# Command line
imagely examples/d3-batch/chart.html examples/d3-batch/chart.gif --json=examples/d3-batch/data.json --bg=purple --batch
```

#### Remote URL
```js
// Node
var imagely = require('imagely');
imagely(
	'http://google.com',
	'examples/google.jpg',
	{ width: 800, height: 600 }
);
```
```sh
# Command line
imagely http://google.com examples/google.jpg -w 800 -h 600
```

#### Retina SVG
```js
// Node
var imagely = require('imagely');
imagely(
	'http://ariya.github.io/svg/tiger.svg',
	'examples/tiger.png',
	{ scale: 2 },
	function(dimensions) {
		console.log(dimensions.width, dimensions.height);
	}
);
```
```sh
# Command line
imagely http://ariya.github.io/svg/tiger.svg examples/tiger.png --scale=2 --log
# Logs: 1004 1051
```


How it works
------------
Imagely is a light wrapper around [puppeteer](https://github.com/GoogleChrome/puppeteer) that facilitates batch processing.
