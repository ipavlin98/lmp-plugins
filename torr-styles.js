(function () {
	"use strict";

	var PLUGIN_ID = "torrent_styles_mod";
	var PLUGIN_NAME = "Torrent Styles MOD";

	var STYLES = {
		".torrent-item__seeds span.high-seeds": {
			color: "#00b300",
			"font-weight": "bold"
		},

		".torrent-item__bitrate span.high-bitrate": {
			color: "#b30000",
			"font-weight": "bold"
		},

		".torrent-item.selector.focus": {
			"box-shadow": "0 0 0 0.3em #1aff00"
		},

		".torrent-serial.selector.focus": {
			"box-shadow": "0 0 0 0.25em #1aff00"
		},

		".torrent-file.selector.focus": {
			"box-shadow": "0 0 0 0.25em #1aff00"
		},

		".torrent-item.focus::after": {
			border: "none"
		},

		".scroll__body": {
			margin: "5px"
		}
	};

	function injectStyles() {
		try {
			var style = document.createElement("style");
			var css = Object.keys(STYLES)
				.map(function (selector) {
					var props = STYLES[selector];
					var rules = Object.keys(props)
						.map(function (prop) {
							return prop + ": " + props[prop] + " !important";
						})
						.join("; ");
					return selector + " { " + rules + " }";
				})
				.join("\n");

			style.setAttribute("data-" + PLUGIN_ID + "-styles", "true");
			style.innerHTML = css;
			document.head.appendChild(style);
		} catch (e) {
			console.error(PLUGIN_NAME + " style injection error:", e);
		}
	}

	function updateTorrentStyles() {
		try {
			document
				.querySelectorAll(".torrent-item__seeds span")
				.forEach(function (span) {
					var value = parseInt(span.textContent, 10) || 0;
					if (value > 10) span.classList.add("high-seeds");
					else span.classList.remove("high-seeds");
				});

			document
				.querySelectorAll(".torrent-item__bitrate span")
				.forEach(function (span) {
					var value = parseFloat(span.textContent) || 0;
					if (value > 50) span.classList.add("high-bitrate");
					else span.classList.remove("high-bitrate");
				});
		} catch (e) {
			console.error(PLUGIN_NAME + " torrent update error:", e);
		}
	}

	function observeDom() {
		try {
			var observer = new MutationObserver(function (mutations) {
				var hasAdded = false;
				for (var i = 0; i < mutations.length; i++) {
					if (mutations[i].addedNodes && mutations[i].addedNodes.length) {
						hasAdded = true;
						break;
					}
				}
				if (hasAdded) updateTorrentStyles();
			});

			observer.observe(document.body, { childList: true, subtree: true });
			updateTorrentStyles();
		} catch (e) {
			console.error(PLUGIN_NAME + " observer error:", e);
			updateTorrentStyles();
		}
	}

	function registerPlugin() {
		try {
			if (typeof Lampa !== "undefined") {
				Lampa.Manifest = Lampa.Manifest || {};
				Lampa.Manifest.plugins = Lampa.Manifest.plugins || {};

				Lampa.Manifest.plugins[PLUGIN_ID] = {
					type: "other",
					name: PLUGIN_NAME,
					version: "1.0.0",
					description: "Дополнительные стили для карточек торрентов."
				};
			}
		} catch (e) {
			console.error(PLUGIN_NAME + " register error:", e);
		} finally {
			window["plugin_" + PLUGIN_ID + "_ready"] = true;
		}
	}

	function waitForAppReady() {
		try {
			if (typeof Lampa !== "undefined") {
				if (window.appready) {
					registerPlugin();
				} else if (
					Lampa.Listener &&
					typeof Lampa.Listener.follow === "function"
				) {
					Lampa.Listener.follow("app", function (e) {
						if (e.type === "ready") registerPlugin();
					});
				} else {
					setTimeout(registerPlugin, 500);
				}
				return;
			}

			var attempts = 0;
			var timer = setInterval(function () {
				attempts++;
				if (typeof Lampa !== "undefined") {
					clearInterval(timer);
					waitForAppReady();
				} else if (attempts > 40) {
					clearInterval(timer);
					window["plugin_" + PLUGIN_ID + "_ready"] = true;
				}
			}, 250);
		} catch (e) {
			console.error(PLUGIN_NAME + " app wait error:", e);
		}
	}

	function start() {
		injectStyles();
		observeDom();
		waitForAppReady();
	}

	start();
})();
