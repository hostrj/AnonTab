var proxy;
var isLoading = false;
var viewer = document.getElementById('viewer');
var navBar = document.getElementById('navbar');
var hstsList = ['*.wikipedia.org', '*.twitter.com', '*.github.com',
                '*.facebook.com', '*.torproject.org'];
chrome.storage.local.get({
    proxy: 'https://feedback.googleusercontent.com/gadgets/proxy?container=' +
        'fbk&url='
}, function(items) {
    proxy = items.proxy;
});

/**
 * Normalize a given URL.
 * @param url {string}, a URI string.
 * @return {string}, either a normalized URL or an empty string.
 */
function normalizeURL(url) {
    'use strict';
    /**
     * Enforce HSTS for all predefined compatible domains.
     * @param url {object}, a URL object.
     * @return {string}, a URL string.
     */
    var mkHstsCompat = function(url) {
        /**
         * Assert it's a known HSTS compatible domain.
         * @param domainPtrn {string}, a domain name pattern.
         * @return {boolean}.
         */
        var isHstsCompat = function(domainPtrn) {
            domainPtrn = domainPtrn.replace('*.', '^(?:[\\w.-]+\\.)?');
            domainPtrn = new RegExp(domainPtrn);
            if (domainPtrn.test(url.hostname)) {
                return true;
            }
            return false;
        };
        if (url.protocol === 'http:' && hstsList.some(isHstsCompat)) {
            url.protocol = 'https:';
        }
        return url.href;
    };
    url = (/^\w+:\/\//.test(url)) ? url : 'http://' + url;
    try {
        url = new URL(url);
    } catch (e) {
        setTimeout(function() {
            alert('Error: "' + url + '" is not a valid URL.');
        }, 100);
        return '';
    }
    return mkHstsCompat(url);
}

/**
 * Pass all given data to the viewer.
 * @param type {string}, the type of the data.
 * @param data {string}, the data to pass.
 * @return void.
 */
function passData(type, data) {
    'use strict';
    viewer.contentWindow.postMessage(
        {proxyUrl: proxy, dataType: type, dataVal: data}, '*'
    );
}

/**
 * Terminate any ongoing connections.
 * @return void.
 */
function stopLoading() {
    isLoading = false;
    window.stop();
}

/**
 * Navigate to a given URL.
 * @param linkUrl {string}, a URL to navigate to.
 * @return void.
 */
function navigate(linkUrl) {
    'use strict';
    if (!linkUrl.startsWith('#')) {
        linkUrl = normalizeURL(linkUrl);
    }
    if (linkUrl) {
        stopLoading();
        passData('href', linkUrl);
    }
}

/**
 * Change the viewer's border color.
 * @param color {string}, a color name.
 * @param loadingFlag {boolean}, determines loading status.
 * @return void.
 */
function changeBorderColor(color, loadingFlag) {
    var interval;
    if (loadingFlag) {
        interval = setInterval(function() {
            if (isLoading) {
                changeBorderColor('red');
                setTimeout(function () {
                    if (isLoading) {
                        changeBorderColor('green');
                    }
                }, 400);
            } else {
                clearInterval(interval);
                changeBorderColor('silver');
            }
        }, 800);
    }
    viewer.style.borderColor = color;
}

/**
 * Proxify both relative and absolute URIs.
 * @param uri {string}, a URI string.
 * @return {string}, a proxified URL string.
 */
function proxUri(uri) {
    var baseURL = navBar.value;
    var hostRe = /\w+:\/\/[^\/]+/;
    uri = /^\w+:\/\//.test(uri) ? uri :
          uri.startsWith('//') ? baseURL.match(/\w+:/) + uri :
          uri.startsWith('/') ? baseURL.match(hostRe) + uri :
          baseURL.match(hostRe) + '/' + uri;
    uri = new URL(uri);
    return proxy + encodeURIComponent(uri);
}

/**
 * Load an external Web resource.
 * @param resourceUrl {string}, the URL of the resource.
 * @param type {string} optional, the type of the resource.
 * @param isTlResource {boolean} optional, flags top-level resources.
 * @return void.
 */
function loadResource(resourceUrl, type, isTlResource) {
    'use strict';
    var url = proxUri(resourceUrl);
    var imgRe = /\\.(?:jpe?g|png|gif|svg|bmp|ico)(?:[?#].*)?$/;
    var docRe = new RegExp(['(?:\\.(?:s?html?|php|(?:j|a)spx?|p(?:y|l)|',
                            'c(?:gi|ss)|js(?:on)?|txt|cfml?)|://.+?',
                            '/(?:[^.?#]*|[^a-z?#]*))(?:[?#].*)?$'].join(''));
    /**
     * Fetch an external resource.
     * @param type {string}, the type of the resource.
     * @return void.
     */
    var fetch = function(type) {
        var xhrReq = new XMLHttpRequest();
        xhrReq.responseType = (type === 'resource') ? 'blob' : 'text';
        xhrReq.onerror = function() {
            if (isLoading && isTlResource) {
                alert('NetworkError: A network error occurred.');
            }
            setTimeout(function() {
                isLoading = false;
            });
        };
        xhrReq.onload = function() {
            var assert, file, reader, responseType;
            /**
             * Parse the `responseText` property of `xhrReq`.
             * @param type {string} optional, the type of the response.
             * @return void.
             */
            var parseResponse = function(type) {
                var markup, responseText;
                if (xhrReq.responseType === 'text') {
                    responseText = xhrReq.responseText;
                    if (type === 'styles') {
                        responseText = '<style>' + responseText + '</style>';
                    }
                    // Proxify all markup.
                    markup = proxify(responseText, proxy);
                    /* Pass the markup to the viewer. */
                    if (type === 'styles') {
                        passData('styles', markup);
                    } else {
                        passData('document', markup);
                        if (/#.+/.test(resourceUrl)) {
                            // Scroll to a given page anchor.
                            navigate('#' + resourceUrl.match(/#.+/));
                        }
                    }
                } else {
                    file = xhrReq.response;
                    if (file.size >= 9000000) {
                        assert = confirm('Too large resource! Proceed anyway?');
                        if (!assert) { return; }
                    }
                    reader = new FileReader();
                    reader.readAsDataURL(file);
                    reader.onloadend = function() {
                        passData('resource', reader.result);
                    };
                }
            };
            try {
                responseType = this.getResponseHeader('Content-Type');
                if (isTlResource && responseType.indexOf(type) !== 0) {
                    responseType = responseType.match(/^\w*/).toString();
                    if (responseType === 'text') {
                        fetch('text');
                        return;
                    } else if (responseType === 'image') {
                        passData('img', url);
                        return;
                    } else if (responseType === 'audio') {
                        passData('audio', url);
                        return;
                    } else if (responseType === 'video') {
                        passData('video', url);
                        return;
                    } else if (type !== 'resource') {
                        fetch('resource');
                        return;
                    }
                }
            } catch (e) {
                // Just continue on a missing content-type header.
            }
            if (this.status === 200) {
                if (type === 'text/css') {
                    parseResponse('styles');
                } else {
                    parseResponse();
                }
            } else if (isTlResource) {
                alert('HTTPError: ' + this.status + ' ' + this.statusText);
                parseResponse();
            }
            setTimeout(function() {
                isLoading = false;
            });
        };
        xhrReq.open('GET', url);
        if (!isLoading) {
            setTimeout(function() {
                isLoading = true;
                changeBorderColor('green', true);
            });
        }
        xhrReq.send();
    };
    if (typeof type === 'string') {
        fetch(type);
    // Is it a document?
    } else if (docRe.test(resourceUrl)) {
        fetch('text');
    // Perhaps an image?
    } else if (imgRe.test(resourceUrl)) {
        passData('img', url);
    // Maybe some audio file?
    } else if (/\.(?:mp3|wav|ogg)(?:[?#].*)?$/i.test(resourceUrl)) {
        passData('audio', url);
    // Probably a video?
    } else if (/\.(?:mp4|webm|3gp)(?:[?#].*)?$/i.test(resourceUrl)) {
        passData('video', url);
    } else {
        fetch('resource');
    }
}

/**
 * Handle all messages sent from the viewer window.
 * @param msgEv {object}, a message event.
 * @return void.
 */
window.onmessage = function (msgEv) {
    'use strict';
    var type, linkUrl, spinner;
    var data = msgEv.data;
    spinner = data.spinner;
    if (spinner) {
        switch (spinner) {
            case 'on':
                changeBorderColor('green', true);
                break;
            case 'off':
                isLoading = false;
                break;
        }
        return;
    }
    type = data.type;
    linkUrl = normalizeURL(data.linkUrl);
    if (linkUrl) {
        // Reset the view.
        passData('', '');
        // Terminate any ongoing connections.
        stopLoading();
        // Load the new resource.
        loadResource(linkUrl, type, true);
    } else {
        linkUrl = data.linkUrl;
    }
    navBar.value = linkUrl;
}

/**
 * A proxy function for `navigate()`.
 * @param ev {object} optional, an event object.
 * @return void.
 */
function initNav(ev) {
    'use strict';
    var keyCode = ev.keyCode;
    var linkUrl = ev.linkUrl || navBar.value;
    if (linkUrl && (!keyCode || keyCode === 13)) {
        navigate(linkUrl);
    }
    if (ev.type === 'submit') {
        navBar.scrollLeft = 0;
        ev.preventDefault();
    }
}

/* Register event listeners to handle user-initiated navigations. */
document.getElementById('navform').onsubmit = initNav;
chrome.runtime.onMessage.addListener(initNav);
