#!/usr/bin/env node

require('babel-register');
var Imagely = require('./lib/imagely.js').default;
var yargs = require('yargs');
var imageSize = require('image-size');
var args = yargs.argv;

var source = args._[0];
var destination = args._[1];
var options = {};
var callback;

options.width = args.width || args.w;
options.height = args.height || args.h;
options.scale = args.scale || args.s;
options.bg = args.bg || args.b;
options.json = args.json || args.d;
options.log = args.log || args.l;
options.batch = args.batch;

if (options.log) {
	callback = function(error) {
		var dimensions;
		try {
			dimensions = imageSize(destination);
		}
		catch (exception) {
			dimensions = { width: null, height: null };
		}

		if (error) {
			console.log(error);
		}
		else {
			console.log(dimensions.width, dimensions.height);
		}
	};
}
else if (options.batch) {
	callback = function() {
		if (this.jsonIndex < this.json.length) {
			var name = this.destination.split('.').slice(0, -1).pop();
			var uniqueName = this.destination.replace(name, name + this.jsonIndex);
			var html = this.setWindowData(this.originalHtmlString, JSON.stringify(this.json[this.jsonIndex]));

			this.page.setContent(html);
			this.renderPage(uniqueName);
			this.jsonIndex++;
		}
	};
}

new Imagely(source, destination, options, callback);
