#!/usr/bin/env node

var Imagely = require('./lib/imagely.js').default;
var yargs = require('yargs');
var path = require('path');
var imageSize = require('image-size');
var args = yargs.argv;

var source = args._[0];
var destination = args._[1];
var options = {};
var callback;
var fs = require('fs');
var logs = {
	failure: [],
	success: []
};

options.width = args.width || args.w;
options.height = args.height || args.h;
options.scale = args.scale || args.s;
options.bg = args.bg || args.b;
options.json = args.json || args.d;
options.log = args.log || args.l;
options.batch = args.batch;
options.logFilepath = args.logFilepath;

function addToBatchLogs(json) {
	var log;
	var dimensions;
	var filename = json.filename;
	var filenameArray = filename.split('_');

	try {
		dimensions = imageSize(destination);
	}
	catch (exception) {
		dimensions = { width: null, height: null };
	}

	log = dimensions;
	log.uuid = filenameArray[1];
	log.endpoint = filenameArray[0];

	// Check if truthy; account for null, 0, or undefined.
	if (log.width && log.height) {
		logs.success.push(log);
	}
	else {
		logs.failure.push(log);
	}
}

function writeLogFile(logFilepath) {
	fs.writeFile(logFilepath, JSON.stringify(logs, null, 4), function(err) {
		if (err) {
			return console.log(err);
		}
	});
}

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
			var json = this.json[this.jsonIndex];
			var name = path.basename(this.destination);
			var html = this.setWindowData(this.originalHtmlString, JSON.stringify(json));
			var filename = this.destination.replace(name, json.filename + '.gif');

			this.page.setContent(html);
			this.renderPage(filename);
			this.jsonIndex++;

			addToBatchLogs(json);
		} else {
			writeLogFile(options.logFilepath);
		}
	};
}

new Imagely(source, destination, options, callback);
