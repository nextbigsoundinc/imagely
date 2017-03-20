import _ from 'lodash';
import Promise from 'bluebird';
import imageSize from 'image-size';
import path from 'path';
import phantom from 'phantom';
import phantomjs from 'phantomjs';
import request from 'request-promise';
const fs = Promise.promisifyAll(require('fs'));

class Imagely {
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
	 * @param {Function} [callback] - Function to call upon completion; signature: (error, dimensions)
	 *                                where `dimensions` is an object with properties: { width, height }
	 */
	constructor(source, destination, options, callback) {
		if (this.isFunction(options)) {
			// Called as imagely(source, destination, callback)
			callback = options;
			options = undefined;
		}

		options = options || {};

		if (this.isUrl(source)) {
			this.renderUrl(source, destination, options, callback);
		}
		else {
			this.renderFile(source, destination, options, callback);
		}
	}

	/**
	 * Generates an image from a URL for an HTML file.
	 *
	 * @private
	 * @param {String} url - URL of the HTML page to render
	 * @param {String} destination - Filepath of the image to save
	 * @param {Object} options
	 * @param {Function} [callback] - Function to be called once the page has been rendered and saved to destination
	 */
	renderUrl(url, destination, options, callback) {
		phantom.create(function(phantomjs) {
			phantomjs.createPage(function(page) {
				page.open(url, function(status) {
					if (status === 'success') {
						this.renderPage(page, phantomjs, destination, options, callback);
					}
					else if (callback) {
						callback(new Error('Error loading URL "' + url + '"'));
					}
				});
			});
		}, {
			binary: phantomjs.path,
			dnodeOpts: { weak: false }
		});
	}

	/**
	 * Generates an image from a local HTML file.
	 *
	 * @todo Refactor to improve modularity & reusability
	 *
	 * @private
	 * @param {String} filepath - Local filepath of the HTML page to render
	 * @param {String} destination - Filepath of the image to save
	 * @param {Object} options
	 * @param {Function} [callback] - Function to be called once the page has been rendered and saved to destination
	 */
	renderFile(filepath, destination, options, callback) {
		var html = fs.readFileSync(filepath, 'utf-8');

		// Finds all external script and stylesheet filenames
		var scripts = html.match(/<script .*?src="(.*?)".*?<\/script>/gi).map(function(tag) {
			return tag.replace(/<script .*?src="(.*?)".*?<\/script>/gi, '$1');
		});
		var stylesheets = html.match(/<link .*?rel="stylesheet".*?>/gi).map(function(tag) {
			return tag.replace(/<link .*?href="(.*?)".*?>/gi, '$1');
		});

		var files = {};
		var dirname = path.dirname(filepath);

		// Fetches all collected script and stylesheet content
		scripts.forEach((filename) => {
			var filepath = this.isUrl(filename) ? filename : path.resolve(dirname, filename);
			files[filename] = {
				externalTag: new RegExp('<script .*?src="' + filename + '".*?</script>', 'gi'),
				inlineTagName: 'script',
				promise: this.fetchFile(filepath),
			};
		});
		stylesheets.forEach((filename) => {
			var filepath = this.isUrl(filename) ? filename : path.resolve(dirname, filename);
			files[filename] = {
				externalTag: new RegExp('<link .*?href="' + filename + '".*?>', 'gi'),
				inlineTagName: 'style',
				promise: this.fetchFile(filepath),
			};
		});
		_.forEach(files, (file) => {
			file.promise.then(function(content) {
				file.content = content;
			});
		});

		if (options.json) {
			var json = fs.readFileSync(options.json, 'utf-8');
			json = JSON.stringify(JSON.parse(json));  // Removes whitespace

			var js = 'window.data = ' + json;
			var script = '<script>' + js + '</script>';
			html = html.replace('<head>', '<head>' + script);
		}

		Promise
			.all(_.map(files, 'promise'))
			.then(function inlineExternalContent() {
				_.forEach(files, function(file) {
					var openTag = '<' + file.inlineTagName + '>';
					var closeTag = '</' + file.inlineTagName + '>';
					var inlineTag = openTag + file.content + closeTag;

					html = html.replace(file.externalTag, function() {
						// Function required to avoid special replacement patterns
						// triggered by str.replace(regex, newSubStr)
						return inlineTag;
					});
				});

				return html;
			})
			.then((html) => {
				phantom.create((phantomjs) => {
					phantomjs.createPage((page) => {
						page.setContent(html);
						this.renderPage(page, phantomjs, destination, options, callback);
					});
				}, {
					binary: phantomjs.path,
					dnodeOpts: { weak: false }
				});
			})
			.catch((err) => {
				if (callback) {
					callback('Error rendering file "' + filepath + '": ' + err)
				}
			});
	}

	/**
	 * Retrieves the content of a local or remote file.
	 *
	 * @param {String} file - Local filepath or remote URL to fetch
	 * @return {Promise} Resolved with the file content
	 */
	fetchFile(file) {
		if (this.isUrl(file)) {
			// Remote file
			return request(file);
		}
		else {
			// Local file
			return fs.readFileAsync(file, 'utf-8');
		}
	}

	/**
	 * Generates an image from a populated PhantomJS page.
	 *
	 * @private
	 * @param {phantomjs.webpage} page
	 * @param {phantomjs} phantomjs
	 * @param {String} destination - Filepath of the image to save
	 * @param {Object} options
	 * @param {Function} [callback] - Function to be called once the page has been rendered and saved to destination
	 */
	renderPage(page, phantomjs, destination, options, callback) {
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

			if (callback) {
				var dimensions;
				try {
					dimensions = imageSize(destination);
				}
				catch (exception) {
					dimensions = { width: null, height: null };
				}
				callback(null, dimensions);
			}
		});
	}

	/**
	 * Is a value a function?
	 *
	 * @param {*} func
	 * @return {Boolean} true if func is a function
	 */
	isFunction(func) {
		return typeof func === 'function';
	}

	/**
	 * Is a string a URL?
	 *
	 * @param {String} str
	 * @return {Boolean} true if str is a URL
	 */
	isUrl(str) {
		return /^https?:\/\//.test(str);
	}
}

export default Imagely;
