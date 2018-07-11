import _ from 'lodash';
import Promise from 'bluebird';

import path from 'path';
import puppeteer from 'puppeteer';
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
	 * @param {Boolean} [options.batch] - Whether to loop through options.json and create a new image each iteration.
	 * @param {Function} [callback] - Function to call upon completion; signature: (error, dimensions)
	 *                                where `dimensions` is an object with properties: { width, height }
	 */
	constructor(source, destination, options, callback) {
		Object.assign(this, { source, destination, options, callback });

		this.json = {};
		this.jsonIndex = 0;
		this.originalHtmlString = '';

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
	 */
	async renderUrl() {
		this.browser = await puppeteer.launch();
		this.page = await this.browser.newPage();
		await this.page.goto(this.source)
		this.renderPage(this.destination);
	}

	/**
	 * Generates an image from a local HTML file.
	 *
	 * @todo Refactor to improve modularity & reusability
	 *
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
			.then(async html => {
				this.browser = await puppeteer.launch();
				this.page = await this.browser.newPage();
				this.originalHtmlString = html;

				const windowData = (this.options.batch) ? this.json[this.jsonIndex] : this.json;
				if (windowData) {
					html = this.setWindowData(this.originalHtmlString, JSON.stringify(windowData));
				}

				await this.page.setContent(html);
				this.renderPage(this.destination);
			})
			.catch((err) => {
				if (this.callback) {
					this.callback('Error rendering file "' + filepath + '": ' + err)
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
	 * @param {String} destination - Filepath of the image to save
	 */
	async renderPage(destination) {

		if (this.options.width || this.options.height || this.options.scale) {
			const origViewport = this.page.viewport();

			await this.page.setViewport({
				width: this.options.width || origViewport.width,
				height: this.options.height || origViewport.height,
				deviceScaleFactor: this.options.scale || 1
			});
		}

		if (this.options.bg) {
			await this.page.evaluate(bg => {
				document.body.bgColor = bg;
			}, this.options.bg);
		}

		await this.page.screenshot({
			path: destination,
			type: 'png',
			omitBackground: true
		});

		// If not batching exit immediately.
		if (!this.options.batch || (this.jsonIndex === this.json.length)) {
			await this.browser.close();
		}

		if (this.callback) {
			this.callback.call(this);
		}
	}

	/**
	 * Adds window.data to an html string and returns it.
	 *
	 * @param {String} html HTML string to add window data to.
	 * @param {Sting} json JSON string to inject into html string.
	 * @return {String} Html string with injected data.
	 */
	setWindowData(html, json) {
		var js = 'window.data = ' + json;
		var script = '<script>' + js + '</script>';

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
