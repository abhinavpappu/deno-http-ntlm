/**
 * Copyright (c) 2013 Sam Decrock https://github.com/SamDecrock/
 * All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

'use strict';

import * as ntlm from './ntlm.ts';

const url = require('url');
const httpreq = require('httpreq');
const _ = require('underscore');
const http = require('http');
const https = require('https');

function request(method, options, finalCallback){
	if(!options.workstation) options.workstation = '';
	if(!options.domain) options.domain = '';

	// extract non-ntlm-options:
	const httpreqOptions = _.omit(options, 'url', 'username', 'password', 'workstation', 'domain');

	// is https?
	let isHttps = false;
	const reqUrl = url.parse(options.url);
	if(reqUrl.protocol == 'https:') isHttps = true;

	// set keepaliveAgent (http or https):
	let keepaliveAgent;

	if(isHttps){
		keepaliveAgent = new https.Agent({keepAlive: true});
	}else{
		keepaliveAgent = new http.Agent({keepAlive: true});
	}

	// build type1 request:

	function sendType1Message (callback) {
		const type1msg = ntlm.createType1Message(options);

		let type1options = {
			headers:{
				'Connection' : 'keep-alive',
				'Authorization': type1msg
			},
			timeout: options.timeout || 0,
			agent: keepaliveAgent,
			allowRedirects: false // don't redirect in httpreq, because http could change to https which means we need to change the keepaliveAgent
		};

		// pass along other options:
		type1options = _.extend({}, _.omit(httpreqOptions, 'headers', 'body'), type1options);

		// send type1 message to server:
		httpreq[method](options.url, type1options, callback);
	}

	function sendType3Message (res, callback) {
		// catch redirect here:
		if(res.headers.location) {
			options.url = res.headers.location;
			return exports[method](options, finalCallback);
		}


		if(!res.headers['www-authenticate'])
			return callback(new Error('www-authenticate not found on response of second request'));

		// parse type2 message from server:
		const type2msg = ntlm.parseType2Message(res.headers['www-authenticate'], callback); //callback only happens on errors
		if(!type2msg) return; // if callback returned an error, the parse-function returns with null

		// create type3 message:
		const type3msg = ntlm.createType3Message(type2msg, options);

		// build type3 request:
		let type3options = {
			headers: {
				'Connection': 'Close',
				'Authorization': type3msg
			},
			allowRedirects: false,
			agent: keepaliveAgent
		};

		// pass along other options:
		type3options.headers = _.extend(type3options.headers, httpreqOptions.headers);
		type3options = _.extend(type3options, _.omit(httpreqOptions, 'headers'));

		// send type3 message to server:
		httpreq[method](options.url, type3options, callback);
	}


	sendType1Message(function (err, res) {
		if(err) return finalCallback(err);
		setImmediate(function () { // doesn't work without setImmediate()
			sendType3Message(res, finalCallback);
		});
	});

};

const methods = ['get', 'put', 'patch', 'post', 'delete', 'options'];
const exportRequests = {};
methods.forEach((method) => {
	exportRequests[method] = (...args) => request(method, ...args);
});

export default request;
export { ntlm };
export const { get, put, patch, post, delete: del, options } = exportRequests;
