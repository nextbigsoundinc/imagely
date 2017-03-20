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
		Object.assign(this, { source, destination, options, callback });

		this.json = {};
		this.batchLength = 1;
		this.batchIndex = 0;
		this.originalHtmlString = '';
		this.phantomjs = undefined;
		this.page = undefined;

		this.imagely();
	}

	imagely() {
		if (this.isFunction(this.options)) {
			this.callback = this.options;
			this.options = undefined;
		}

		this.options = this.options || {};

		if (this.isUrl(this.source)) {
			this.renderUrl();
		}
		else {
			this.renderFile();
		}
	}

	/**
	 * Generates an image from a URL for an HTML file.
	 *
	 * @private
	 */
	renderUrl() {
		phantom.create(function(phantomjs) {
			phantomjs.createPage(function(page) {
				page.open(this.source, function(status) {
					if (status === 'success') {
						this.renderPage(this.destination);
					}
					else if (this.callback) {
						callback(new Error('Error loading URL "' + this.source + '"'));
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
	 */
	renderFile() {
		var html = fs.readFileSync(this.source, 'utf-8');

		// Finds all external script and stylesheet filenames
		var scripts = html.match(/<script .*?src="(.*?)".*?<\/script>/gi).map(function(tag) {
			return tag.replace(/<script .*?src="(.*?)".*?<\/script>/gi, '$1');
		});
		var stylesheets = html.match(/<link .*?rel="stylesheet".*?>/gi).map(function(tag) {
			return tag.replace(/<link .*?href="(.*?)".*?>/gi, '$1');
		});

		var files = {};
		var dirname = path.dirname(this.source);

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

		if (this.options.json) {
			this.json = JSON.parse(fs.readFileSync(this.options.json, 'utf-8'));

			// If not batching images, set window data once.
			if (!this.options.batch) {
				html = this.setWindowData(html, JSON.stringify(this.json));
			}
			else {
				this.batchLength = this.json.length;
			}
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
						this.page = page;
						this.phantomjs = phantomjs;

						// page, phantomjs, destination, options, callback
						if (!this.options.batch) {
							this.page.setContent(html);
							this.renderPage(this.destination);
						} else {
							this.originalHtmlString = html;							
							this.batch();
						}
					});
				}, {
					binary: phantomjs.path,
					dnodeOpts: { weak: false }
				});
			})
			.catch((err) => {
				if (this.callback) {
					callback('Error rendering file "' + filepath + '": ' + err)
				}
			});
	}

	/**
	 * Assuming css, html, and js are the same in source files, render pages with unique json data.
	 * The hope is
	 *		1) We can make time gains by not opening and closing phantom every image.
	 *		2) We can make time gains by caching repeated generated css, js, and html.
	 */
	batch() {
		if (this.batchIndex < this.batchLength) {
			let html = this.setWindowData(this.originalHtmlString, JSON.stringify(this.json[this.batchIndex]));
			this.page.setContent(html);

			let batchDestination = this.makeUniqueDestination(this.destination, this.batchIndex);
			this.renderPage(batchDestination);
			this.batchIndex++;
		}
	}

	/**
	 * Returns a unique image destination name. The logic is arbitrary and should be replaced as needed.
	 *
	 * @param {String} destination Original local filepath.
	 * @param {Number} index Index of image we're renaming; a quick way to make each image unique.
	 * @return {String} Unique destination.
	 */
	makeUniqueDestination(destination, index) {
		let name = destination.split('.').slice(0, -1).pop();

		return destination.replace(name, name + index);
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
	 * @param {String} destination - Filepath of the image to save
	 */
	renderPage(destination) {
		if (this.options.width || this.options.height) {
			this.page.set('viewportSize', { width: this.options.width, height: this.options.height });
		}
		if (this.options.scale) {
			this.page.set('zoomFactor', this.options.scale);
		}
		if (this.options.bg) {
			this.page.evaluate('function() { document.body.bgColor = "' + this.options.bg + '"; }');
		}

		this.page.render(destination, () => {
			if (!this.options.batch || (this.batchIndex === this.batchLength)) {
				this.phantomjs.exit();
			}

			if (this.callback) {
				var dimensions;
				try {
					dimensions = imageSize(destination);
				}
				catch (exception) {
					dimensions = { width: null, height: null };
				}
				this.callback(null, dimensions);
			}

			if (!(this.batchIndex === this.batchLength)) {
				this.batch();
			}
		});
	}

	setWindowData(html, json) {
		var js = 'window.data = ' + json;
		var script = '<script>' + js + '</script>';

		if (this.options.batch) {
			// Replace originalHtmlString when batching so we don't append scripts to same html string.
			html = this.originalHtmlString;
		}

		return html.replace('<head>', '<head>' + script);
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
