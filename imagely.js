var fs = require('fs');
var jsdom = require('jsdom');
var imageSize = require('image-size');
var path = require('path');
var phantom = require('phantom');
var phantomjs = require('phantomjs');

/**
 * Renders a source HTML file as an image.
 *
 * @public
 * @param {String} source - HTML filepath or URL
 * @param {String} destination - Destination image filepath; supported extensions are JPG, PNG, GIF, PDF
 * @param {Object} [options]
 * @param {Number} [options.width] - Viewport pixel width
 * @param {Number} [options.height] - Viewport pixel height
 * @param {Number} [options.scale=1] - Zoom level; use scale = 2 for HiDPI/Retina-ready output
 * @param {String} [options.bg] - Background color
 * @param {String} [options.json] - Filepath of JSON data to preload into window.data
 * @param {Function} [callback] - Function to call upon completion; passed the image dimensions as { width, height }
 */
function imagely(source, destination, options, callback) {
	if (isFunction(options)) {
		// Called as imagely(source, destination, callback)
		callback = options;
		options = undefined;
	}

	options = options || {};

	if (isUrl(source)) {
		renderUrl(source, destination, options, callback);
	}
	else {
		renderFile(source, destination, options, callback);
	}
}

function renderUrl(url, destination, options, callback) {
	phantom.create(function(phantomjs) {
		phantomjs.createPage(function(page) {
			page.open(url, function(status) {
				if (status !== 'success') {
					console.error('imagely: Error while loading URL "' + url + '"');
					return;
				}

				renderPage(page, phantomjs, destination, options, callback);
			});
		});
	}, { binary: phantomjs.path });
}

/**
 * Generates an image from a local file.
 *
 * @private
 */
function renderFile(filepath, destination, options, callback) {
	jsdom.env({
		file: filepath,
		features: {
			FetchExternalResources: ['link', 'script'],
			ProcessExternalResources: ['script'],
		},
		created: function(err, window) {
			if (err) {
				console.error('imagely: Error while creating window', err);
				return;
			}

			if (options.json) {
				var json = fs.readFileSync(options.json, 'utf-8');
				window.data = JSON.parse(json);
			}
		},
		done: function(err, window) {
			if (err) {
				console.error('imagely: Error while loading document', err);
				return;
			}

			var html = window.document.documentElement.outerHTML;

			// Removes scripts since they have already been processed
			html = html.replace(/<script .*?<\/script>/gi, '');

			// Inlines external stylesheets
			html = html.replace(/(<link [^>]*href="([^"]+.css)"[^>]*>)/gi, function(subject, linkTag, cssFile) {
				var cssFilepath = path.resolve(path.dirname(filepath), cssFile);
				var css = fs.readFileSync(cssFilepath, 'utf-8');
				return '<style>' + css + '</style>';
			});

			phantom.create(function(phantomjs) {
				phantomjs.createPage(function(page) {
					page.setContent(html);
					renderPage(page, phantomjs, destination, options, callback);
				});
			}, { binary: phantomjs.path });
		},
	});
}

function renderPage(page, phantomjs, destination, options, callback) {
	if (options.width || options.height) {
		page.set('viewportSize', { width: options.width, height: options.height });
	}
	if (options.scale) {
		page.set('zoomFactor', options.scale);
	}
	if (options.bg) {
		page.evaluate('function() { document.body.bgColor = "' + options.bg + '"; }');
	}

	page.render(destination, function() {
		phantomjs.exit();

		if (isFunction(callback)) {
			var dimensions = imageSize(destination);
			callback(dimensions);
		}
	});
}

function isFunction(func) {
	return typeof func === 'function';
}

function isUrl(str) {
	return /^https?:\/\//.test(str);
}

module.exports = imagely;
